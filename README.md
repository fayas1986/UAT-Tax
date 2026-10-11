# Alwadi-Zatca
Alwadi ZATCA E-Invoicing Integration Application

This repository contains the complete ZATCA Phase 2 E-Invoicing integration solution for Alwadi, supporting multi-branch compliance, cryptographic onboarding (CSR/CSID), invoice signing, reporting, and clearance.

## Quick Start

### Prerequisites
- Node.js (v18+ or v20+)
- PostgreSQL (or Neon DB connection)
- .NET 8 SDK (for local ZATCA SDK execution)

### Installation & Run

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure environment:
   Set up your `.env` and `.env.local` with database connection and configuration keys.

3. Run locally:
   ```bash
   npm run dev:all
   ```
