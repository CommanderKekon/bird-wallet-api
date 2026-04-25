require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');

const app = express();
app.use(cors());
app.use(express.json());

// ─── PLAID SETUP ────────────────────────────────────────────

const plaidConfig = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(plaidConfig);

// 1. Create a link token to start the Plaid Link flow
app.post('/api/plaid/create-link-token', async (req, res) => {
  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: req.body.userId || 'default-user' },
      client_name: 'Bird Wallet',
      products: ['transactions'],
      country_codes: ['US'],
      language: 'en',
    });
    res.json({ link_token: response.data.link_token });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create link token' });
  }
});

// 2. Exchange public token for access token after user connects
app.post('/api/plaid/exchange-token', async (req, res) => {
  try {
    const { public_token } = req.body;
    const response = await plaidClient.itemPublicTokenExchange({ public_token });
    const accessToken = response.data.access_token;
    const itemId = response.data.item_id;
    res.json({ access_token: accessToken, item_id: itemId });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to exchange token' });
  }
});

// 3. Fetch accounts using access token
app.post('/api/plaid/get-accounts', async (req, res) => {
  try {
    const { access_token } = req.body;
    const response = await plaidClient.accountsGet({ access_token });
    res.json({ accounts: response.data.accounts, item: response.data.item });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

// 4. Fetch transactions using access token
app.post('/api/plaid/get-transactions', async (req, res) => {
  try {
    const { access_token } = req.body;
    const now = new Date();
    const thirtyDaysAgo = new Date(now.setDate(now.getDate() - 30)).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    const response = await plaidClient.transactionsGet({
      access_token,
      start_date: thirtyDaysAgo,
      end_date: today,
    });
    res.json({ transactions: response.data.transactions });
  } catch (err) {
    console.error(err.response?.data || err.message);
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

// ─── EXPERIAN SETUP ─────────────────────────────────────────

// Helper: get Experian access token
const getExperianToken = async () => {
  const res = await fetch(`${process.env.EXPERIAN_BASE_URL}/oauth2/v1/token`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'Grant_type': 'password'
    },
    body: JSON.stringify({
      username: process.env.EXPERIAN_USERNAME,
      password: process.env.EXPERIAN_PASSWORD,
      client_id: process.env.EXPERIAN_CLIENT_ID,
      client_secret: process.env.EXPERIAN_CLIENT_SECRET
    })
  });
  const data = await res.json();
  console.log('Experian token response status:', data.access_token ? 'success' : 'failed');
  return data.access_token;
};

// 5. Get credit score from Experian
app.post('/api/experian/credit-score', async (req, res) => {
  try {
    const { firstName, lastName, ssn, address, city, state, zip } = req.body;

    console.log('Fetching Experian token...');
    const token = await getExperianToken();
    console.log('Token received:', token ? 'yes' : 'no');

    const payload = {
      consumerPii: {
        primaryApplicant: {
          name: { firstName, lastName },
          ssn: { ssn },
          currentAddress: {
            line1: address,
            city,
            state,
            zipCode: zip
          }
        }
      },
      requestor: {
        subscriberCode: process.env.EXPERIAN_SUBSCRIBER_CODE
      },
      addOns: {
        riskModels: {
          modelIndicator: ['V4'],
          scorePercentile: 'Y'
        }
      }
    };

    // Use the gateway URL pattern that Experian sandbox requires
    const targetUrl = `${process.env.EXPERIAN_BASE_URL}/consumerservices/credit-profile/v2/credit-report`;
    const gatewayUrl = `${process.env.EXPERIAN_BASE_URL}/eits/gdp/v1/request?targeturl=${encodeURIComponent(targetUrl)}`;

    console.log('Calling Experian via gateway:', gatewayUrl);

    const response = await fetch(gatewayUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'clientReferenceId': 'SBMYSQL'
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    console.log('Experian response:', JSON.stringify(data));

    const profile = data.creditProfile?.[0];
    const riskModel = profile?.riskModel?.[0];
    const score = riskModel?.score !== undefined ? parseInt(riskModel.score) : null;

    console.log('Extracted score:', score);

    res.json({
      score: score,
      scoreFactors: riskModel?.scoreFactors || [],
      scorePercentile: riskModel?.scorePercentile,
      raw: data
    });

  } catch (err) {
    console.error('Experian error:', err);
    res.status(500).json({ error: 'Failed to fetch credit score', details: err.message });
  }
});

// ─── START SERVER ───────────────────────────────────────────

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Bird Wallet API running on port ${PORT}`));
