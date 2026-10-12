import jwt from 'jsonwebtoken';
import app from '../server/src/index.js';

// Approved Alwadi proxy endpoints - external third-party customer IPs are strictly rejected
const APPROVED_PROXY_DOMAINS = [
  'alwadi.sa',
  'alwadipoultry.com',
  'zatca.alwadi.sa',
  'localhost',
  '127.0.0.1'
];

const JWT_SECRET = process.env.JWT_SECRET || 'alwadi_zatca_secure_dev_jwt_secret_key_2026_at_least_32_chars_long_64hex';



export default async (req: any, res: any) => {
  try {
    let url = req.url || '';
    if (!url.startsWith('/api')) {
      url = '/api' + (url.startsWith('/') ? url : '/' + url);
    }
    req.url = url;

    // 1. Check if an explicit, valid Alwadi proxy endpoint is configured via environment variables
    const customBackendUrl = process.env.ALWADI_BACKEND_URL || process.env.KSA_API_BASE_URL || process.env.BACKEND_API_BASE_URL;
    
    if (customBackendUrl) {
      let isApproved = false;
      try {
        const parsed = new URL(customBackendUrl);
        isApproved = APPROVED_PROXY_DOMAINS.some(domain => 
          parsed.hostname === domain || parsed.hostname.endsWith(`.${domain}`)
        );
      } catch {
        isApproved = false;
      }

      if (isApproved) {
        const targetUrl = `${customBackendUrl.replace(/\/$/, '')}${url}`;
        const headers: Record<string, string> = {};
        for (const [key, val] of Object.entries(req.headers)) {
          const lower = key.toLowerCase();
          if (
            !lower.startsWith('x-vercel-') &&
            !['host', 'content-length', 'transfer-encoding', 'connection', 'accept-encoding'].includes(lower) &&
            val !== undefined
          ) {
            headers[key] = Array.isArray(val) ? val.join(', ') : (val as string);
          }
        }

        const options: any = { method: req.method, headers };
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.body) {
          options.body = typeof req.body === 'string' || Buffer.isBuffer(req.body)
            ? req.body
            : JSON.stringify(req.body);
        }

        const proxyResponse = await fetch(targetUrl, options);
        const contentType = proxyResponse.headers.get('content-type');
        const arrayBuffer = await proxyResponse.arrayBuffer();

        res.status(proxyResponse.status);
        if (contentType) res.setHeader('content-type', contentType);
        return res.send(Buffer.from(arrayBuffer));
      } else {
        console.warn(`[Security Guard] Blocked proxy attempt to unauthorized host '${customBackendUrl}'. Executing local Alwadi server directly.`);
      }
    }

// Direct Serverless Execution: Execute the Alwadi Express app directly
    return app(req, res);
  } catch (error: any) {
    console.error('[Vercel Serverless] Error running request handler:', error);
    return res.status(500).json({
      error: 'Internal Server Error',
      message: error?.message || 'Server error',
      source: 'alwadi-zatca-vercel'
    });
  }
};
