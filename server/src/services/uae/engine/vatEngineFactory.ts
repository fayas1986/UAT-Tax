/**
 * UAE VAT Engine Factory
 * Dynamically resolves the versioned tax calculation engine based on invoice issue date
 * or explicit regulatory rule version string.
 */

import { IUaeTaxRuleEngine } from './taxRuleEngine.interface.js';
import { UaeVatEngine2018 } from './uaeVatEngine.2018.js';
import { UaeVatEngine2026 } from './uaeVatEngine.2026.js';

export class UaeVatEngineFactory {
  private static readonly engine2018 = new UaeVatEngine2018();
  private static readonly engine2026 = new UaeVatEngine2026();

  /**
   * Resolves the appropriate engine based on the invoice issue date.
   * Dates before 2026-07-01 route to the legacy 2018 engine.
   * Dates on or after 2026-07-01 route to the 2026/2027 eInvoicing engine.
   */
  public static getEngineByDate(issueDate: string): IUaeTaxRuleEngine {
    if (!issueDate) {
      return this.engine2026;
    }

    const cleanDate = issueDate.slice(0, 10);
    if (cleanDate < '2026-07-01') {
      return this.engine2018;
    }
    return this.engine2026;
  }

  /**
   * Resolves the engine by explicit rule version (e.g. for re-calculating historical audits).
   */
  public static getEngineByVersion(version: string): IUaeTaxRuleEngine {
    if (version === '2018.1') {
      return this.engine2018;
    }
    return this.engine2026;
  }
}
