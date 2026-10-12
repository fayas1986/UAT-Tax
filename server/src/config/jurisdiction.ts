/**
 * Sovereign Jurisdiction Deployment Configuration
 * Enforces startup validation and regional profile gating for Saudi Arabia and UAE.
 */

export type DeploymentRegion = 'SA' | 'AE' | 'ALL';

export class JurisdictionConfigurationException extends Error {
  constructor(message: string, public readonly code: string = 'CONFIG_ERROR') {
    super(message);
    this.name = 'JurisdictionConfigurationException';
  }
}

export class JurisdictionConfig {
  private static region: DeploymentRegion | null = null;

  /**
   * Initializes and strictly validates the deployment region at application bootstrap.
   * In production (NODE_ENV === 'production'):
   *  - DEPLOYMENT_REGION must be explicitly set to 'SA' or 'AE'.
   *  - 'ALL' is strictly prohibited.
   *  - Missing or invalid values trigger a fatal error.
   */
  public static initialize(explicitRegion?: string): DeploymentRegion {
    const raw = (explicitRegion ?? process.env.DEPLOYMENT_REGION)?.trim().toUpperCase();
    const isProduction = process.env.NODE_ENV === 'production';

    if (!raw) {
      if (isProduction) {
        const errorMsg = 'FATAL: DEPLOYMENT_REGION is mandatory in production. Must be explicitly set to "SA" or "AE".';
        console.error(`[JurisdictionConfig] ${errorMsg}`);
        throw new JurisdictionConfigurationException(errorMsg, 'MISSING_DEPLOYMENT_REGION');
      }
      this.region = 'ALL';
      return this.region;
    }

    if (raw !== 'SA' && raw !== 'AE' && raw !== 'ALL') {
      const errorMsg = `FATAL: Invalid DEPLOYMENT_REGION "${raw}". Must be "SA" or "AE".`;
      console.error(`[JurisdictionConfig] ${errorMsg}`);
      throw new JurisdictionConfigurationException(errorMsg, 'INVALID_DEPLOYMENT_REGION');
    }

    if (isProduction && raw === 'ALL') {
      const errorMsg = 'FATAL: DEPLOYMENT_REGION="ALL" is forbidden in production. Must be explicitly "SA" or "AE".';
      console.error(`[JurisdictionConfig] ${errorMsg}`);
      throw new JurisdictionConfigurationException(errorMsg, 'FORBIDDEN_ALL_IN_PRODUCTION');
    }

    this.region = raw as DeploymentRegion;
    return this.region;
  }

  public static getActiveRegion(): DeploymentRegion {
    if (!this.region) {
      return this.initialize();
    }
    return this.region;
  }

  public static isSaudiEnabled(): boolean {
    const active = this.getActiveRegion();
    return active === 'SA' || active === 'ALL';
  }

  public static isUaeEnabled(): boolean {
    const active = this.getActiveRegion();
    return active === 'AE' || active === 'ALL';
  }

  public static resetForTesting(): void {
    this.region = null;
  }
}
