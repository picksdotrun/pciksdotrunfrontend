BNB Prediction Market Deployment (Mainnet)

This folder contains a minimal Hardhat project to deploy the per‑pick prediction market contracts to BNB Smart Chain (mainnet) and to create markets (one per pick).

What’s here
- contracts/prediction/
  - OutcomeShare.sol: Non‑transferable ERC‑20 “receipt” token (YES/NO shares)
  - PredictionMarket.sol: Per‑pick market vault with buy/resolve/claim
- scripts/
  - deploy-market.js: Directly deploy a single market (without a factory)
  - create-market.js: Call an existing Factory’s createMarket to deploy a market
- hardhat.config.js: Hardhat config with bscMainnet network
- .env.example: Environment template to fill with your mainnet RPC and keys

Quick start (Mainnet)
1) cd ./evm
2) Copy .env.example → .env and fill values:
   - BSC_MAINNET_RPC: your BSC mainnet RPC URL
   - DEPLOYER_PK: private key of a wallet funded with a small amount of BNB (gas)
   - RESOLVER: address allowed to call resolve()
   - FEE_RECIPIENT: treasury/resolver fee recipient
   - ESCROW_ASSET: mainnet ERC‑20 used for staking (e.g., WBNB or FDUSD)
   - FEE_BPS: e.g., 300 for 3%
   - (Optional) FACTORY_ADDR for create‑market.js if you have a Factory deployed
3) Install deps: npm i
4) Compile: npx hardhat compile

Deploy a standalone market (no factory)
- Edit params in scripts/deploy-market.js or supply env vars
- Run: npx hardhat run scripts/deploy-market.js --network bscMainnet

Create a market via existing Factory
- Ensure FACTORY_ADDR is set in .env
- Edit name/end/cutoff in scripts/create-market.js
- Run: npx hardhat run scripts/create-market.js --network bscMainnet

Security notes
- Keep DEPLOYER_PK small and dedicated. Never commit it.
- Double‑check ESCROW_ASSET is a mainnet token address.
- feeBps bounded (e.g., ≤ 1000). cutoffTime should be < endTime.
