# Bird Wallet API

Plaid integration backend for Bird Wallet.

## Environment Variables

Set these in Render's environment variables (never in code):

- `PLAID_CLIENT_ID` - Your Plaid client ID
- `PLAID_SECRET` - Your Plaid sandbox or production secret
- `PLAID_ENV` - Either `sandbox` or `production`

## Endpoints

- `POST /api/plaid/create-link-token` - Start Plaid Link flow
- `POST /api/plaid/exchange-token` - Exchange public token for access token
- `POST /api/plaid/get-accounts` - Fetch connected accounts
- `POST /api/plaid/get-transactions` - Fetch recent transactions
