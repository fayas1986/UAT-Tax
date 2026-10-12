/**
 * Atomic Credit Note Persistence & Concurrency Guard Service
 * 
 * Guarantees transactional atomicity, exclusive row-level locking,
 * and rollback safety for UAE Tax Credit Note balance adjustments.
 * Eliminates race conditions (e.g. concurrent over-crediting / double-spend).
 */

import { Decimal } from '../utils/decimal.js';
import {
  CreditNoteAdjuster,
  CreditNoteAdjustmentInput,
  CreditNoteAdjustmentResult,
  AppliedCreditNoteRecord,
  PrecedingInvoiceReference,
} from './creditNoteAdjuster.js';

export interface StoredInvoiceRecord {
  invoiceNumber: string;
  issueDate: string;
  uuid: string;
  totalExclusiveAmount: string;
  totalVatAmount: string;
  totalInclusiveAmount: string;
  remainingExclusiveBalance: string;
  remainingVatBalance: string;
  remainingInclusiveBalance: string;
  version: number;
  appliedCreditNotes: AppliedCreditNoteRecord[];
}

export interface ICreditNoteRepository {
  /**
   * Executes a callback within an exclusive row lock on the target invoice inside a database transaction.
   * In PostgreSQL/Prisma: `SELECT * FROM "Invoice" WHERE "invoiceNumber" = $1 FOR UPDATE`.
   */
  withInvoiceLock<T>(
    invoiceNumber: string,
    operation: (invoice: StoredInvoiceRecord, tx?: unknown) => Promise<T>
  ): Promise<T>;

  /**
   * Persists the newly approved credit note and atomically updates the invoice balances within the active transaction.
   */
  persistCreditNoteAdjustment(
    invoiceNumber: string,
    newCreditNote: AppliedCreditNoteRecord,
    updatedBalances: {
      remainingNet: Decimal;
      remainingVat: Decimal;
      remainingGross: Decimal;
      newVersion: number;
    },
    tx?: unknown
  ): Promise<void>;
}

/**
 * Production-ready Prisma PostgreSQL implementation.
 * Wraps row lock, ledger read, balance check, and update in a single atomic database transaction.
 */
export class PrismaCreditNoteRepository implements ICreditNoteRepository {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly prisma: any) {}

  public async withInvoiceLock<T>(
    invoiceNumber: string,
    operation: (invoice: StoredInvoiceRecord, tx?: unknown) => Promise<T>
  ): Promise<T> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return await this.prisma.$transaction(async (tx: any) => {
      // 1. Acquire exclusive row lock in PostgreSQL using SELECT ... FOR UPDATE
      const lockedRows = await tx.$queryRawUnsafe(`
        SELECT "id", "invoice_number" as "invoiceNumber", "issue_date" as "issueDate", "uuid", 
               "total_exclusive_amount" as "totalExclusiveAmount", 
               "total_vat_amount" as "totalVatAmount", 
               "total_inclusive_amount" as "totalInclusiveAmount",
               "remaining_exclusive_balance" as "remainingExclusiveBalance", 
               "remaining_vat_balance" as "remainingVatBalance", 
               "remaining_inclusive_balance" as "remainingInclusiveBalance",
               "version"
        FROM "invoices"
        WHERE "invoice_number" = $1
        FOR UPDATE
      `, invoiceNumber);

      if (!lockedRows || lockedRows.length === 0) {
        throw new Error(`Preceding invoice "${invoiceNumber}" not found in database.`);
      }
      if (lockedRows.length > 1) {
        throw new Error(`Invoice identity uniqueness violation: multiple rows found for invoice "${invoiceNumber}". Invoices must have unique identifiers.`);
      }
      const row = lockedRows[0];

      // 2. Fetch existing credit notes inside the same locked transaction
      const rawCreditNotes = await tx.creditNote?.findMany?.({
        where: { precedingInvoiceNumber: invoiceNumber, status: 'ACCEPTED' },
        orderBy: { createdAt: 'asc' }
      }) || [];

      const storedInvoice: StoredInvoiceRecord = {
        invoiceNumber: row.invoiceNumber,
        issueDate: String(row.issueDate),
        uuid: row.uuid,
        totalExclusiveAmount: String(row.totalExclusiveAmount),
        totalVatAmount: String(row.totalVatAmount),
        totalInclusiveAmount: String(row.totalInclusiveAmount),
        remainingExclusiveBalance: String(row.remainingExclusiveBalance ?? row.totalExclusiveAmount),
        remainingVatBalance: String(row.remainingVatBalance ?? row.totalVatAmount),
        remainingInclusiveBalance: String(row.remainingInclusiveBalance ?? row.totalInclusiveAmount),
        version: Number(row.version ?? 1),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        appliedCreditNotes: rawCreditNotes.map((cn: any) => ({
          creditNoteNumber: cn.creditNoteNumber,
          creditNoteIssueDate: cn.issueDate,
          creditedNet: cn.creditedNet.toString(),
          creditedVat: cn.creditedVat.toString(),
          creditedGross: cn.creditedGross.toString()
        }))
      };

      // 3. Execute balance check and persistence within the active transaction
      return await operation(storedInvoice, tx);
    }, {
      isolationLevel: 'ReadCommitted',
      timeout: 10000
    });
  }

  public async persistCreditNoteAdjustment(
    invoiceNumber: string,
    newCreditNote: AppliedCreditNoteRecord,
    updatedBalances: {
      remainingNet: Decimal;
      remainingVat: Decimal;
      remainingGross: Decimal;
      newVersion: number;
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx?: any
  ): Promise<void> {
    if (!tx) {
      throw new Error(
        `Transactional integrity violation: persistCreditNoteAdjustment must execute within the active database transaction for invoice "${invoiceNumber}".`
      );
    }
    const client = tx;
    
    // Write credit note record
    if (client.creditNote?.create) {
      await client.creditNote.create({
        data: {
          creditNoteNumber: newCreditNote.creditNoteNumber,
          precedingInvoiceNumber: invoiceNumber,
          issueDate: newCreditNote.creditNoteIssueDate,
          creditedNet: newCreditNote.creditedNet.toString(),
          creditedVat: newCreditNote.creditedVat.toString(),
          creditedGross: (newCreditNote.creditedGross || '').toString(),
          status: 'ACCEPTED'
        }
      });
    }

    // Atomically decrement remaining balances and increment version
    await client.$executeRawUnsafe(`
      UPDATE "invoices"
      SET "remaining_exclusive_balance" = $1,
          "remaining_vat_balance" = $2,
          "remaining_inclusive_balance" = $3,
          "version" = $4
      WHERE "invoice_number" = $5
    `,
      updatedBalances.remainingNet.toString(),
      updatedBalances.remainingVat.toString(),
      updatedBalances.remainingGross.toString(),
      updatedBalances.newVersion,
      invoiceNumber
    );
  }
}

/**
 * In-Memory Transactional Store for deterministic unit & concurrency testing.
 * Implements strict mutual-exclusion row locking per invoiceNumber with rollback protection.
 */
export class InMemoryTransactionalInvoiceStore implements ICreditNoteRepository {
  private invoices = new Map<string, StoredInvoiceRecord>();
  private locks = new Map<string, Promise<void>>();

  public seedInvoice(record: StoredInvoiceRecord): void {
    this.invoices.set(record.invoiceNumber, {
      ...record,
      appliedCreditNotes: [...(record.appliedCreditNotes || [])]
    });
  }

  public getInvoice(invoiceNumber: string): StoredInvoiceRecord | undefined {
    return this.invoices.get(invoiceNumber);
  }

  public async withInvoiceLock<T>(
    invoiceNumber: string,
    operation: (invoice: StoredInvoiceRecord, tx?: unknown) => Promise<T>
  ): Promise<T> {
    // Acquire mutex for this invoiceNumber
    while (this.locks.has(invoiceNumber)) {
      await this.locks.get(invoiceNumber);
    }

    let releaseLock!: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this.locks.set(invoiceNumber, lockPromise);

    try {
      const inv = this.invoices.get(invoiceNumber);
      if (!inv) {
        throw new Error(`Preceding invoice "${invoiceNumber}" not found in database.`);
      }

      // Snapshot for atomic rollback simulation
      const snapshot: StoredInvoiceRecord = {
        ...inv,
        appliedCreditNotes: [...inv.appliedCreditNotes]
      };

      try {
        return await operation(snapshot, null);
      } catch (err) {
        // Rollback state on error
        this.invoices.set(invoiceNumber, snapshot);
        throw err;
      }
    } finally {
      this.locks.delete(invoiceNumber);
      releaseLock();
    }
  }

  public async persistCreditNoteAdjustment(
    invoiceNumber: string,
    newCreditNote: AppliedCreditNoteRecord,
    updatedBalances: {
      remainingNet: Decimal;
      remainingVat: Decimal;
      remainingGross: Decimal;
      newVersion: number;
    }
  ): Promise<void> {
    const inv = this.invoices.get(invoiceNumber);
    if (!inv) {
      throw new Error(`Invoice "${invoiceNumber}" not found during persistence.`);
    }

    // Atomically append credit note and update remaining balances
    inv.appliedCreditNotes.push(newCreditNote);
    inv.remainingExclusiveBalance = updatedBalances.remainingNet.toString();
    inv.remainingVatBalance = updatedBalances.remainingVat.toString();
    inv.remainingInclusiveBalance = updatedBalances.remainingGross.toString();
    inv.version = updatedBalances.newVersion;
  }
}

export class CreditNotePersistenceService {
  constructor(private readonly repository: ICreditNoteRepository) {}

  /**
   * Atomically validates, applies, and persists a credit note adjustment.
   * Under concurrent requests, row-level locking guarantees sequential processing
   * and prevents race conditions from exceeding the remaining creditable balance.
   */
  public async processCreditNoteAdjustment(
    input: Omit<CreditNoteAdjustmentInput, 'previouslyAppliedCreditNotes' | 'precedingInvoice'> & {
      invoiceNumber: string;
    }
  ): Promise<CreditNoteAdjustmentResult> {
    return await this.repository.withInvoiceLock(input.invoiceNumber, async (storedInvoice, tx) => {
      const precedingRef: PrecedingInvoiceReference = {
        invoiceNumber: storedInvoice.invoiceNumber,
        issueDate: storedInvoice.issueDate,
        uuid: storedInvoice.uuid,
        totalExclusiveAmount: storedInvoice.totalExclusiveAmount,
        totalVatAmount: storedInvoice.totalVatAmount,
        totalInclusiveAmount: storedInvoice.totalInclusiveAmount,
      };

      // 1. Calculate adjustment with current database state
      const calcResult = CreditNoteAdjuster.calculateAdjustment({
        creditNoteNumber: input.creditNoteNumber,
        creditNoteIssueDate: input.creditNoteIssueDate,
        reasonCode: input.reasonCode,
        reasonDescription: input.reasonDescription,
        precedingInvoice: precedingRef,
        previouslyAppliedCreditNotes: storedInvoice.appliedCreditNotes,
        adjustmentLines: input.adjustmentLines,
      });

      // 2. If validation fails, abort immediately without mutating persistence
      if (!calcResult.isValid) {
        return calcResult;
      }

      // 3. Persist atomically inside the same transaction
      const appliedRecord: AppliedCreditNoteRecord = {
        creditNoteNumber: calcResult.creditNoteNumber,
        creditNoteIssueDate: input.creditNoteIssueDate,
        creditedNet: calcResult.currentCreditedNet,
        creditedVat: calcResult.currentCreditedVat,
        creditedGross: calcResult.currentCreditedGross,
      };

      await this.repository.persistCreditNoteAdjustment(
        storedInvoice.invoiceNumber,
        appliedRecord,
        {
          remainingNet: calcResult.remainingNetBalance,
          remainingVat: calcResult.remainingVatBalance,
          remainingGross: calcResult.remainingGrossBalance,
          newVersion: storedInvoice.version + 1,
        },
        tx
      );

      return calcResult;
    });
  }
}
