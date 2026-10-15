import { createRequire } from "node:module";
import type * as PumpSdk from "@pump-fun/pump-sdk";
import type * as PumpSwapSdk from "@pump-fun/pump-swap-sdk";
import type * as SplToken from "@solana/spl-token";
import type * as Web3 from "@solana/web3.js";

// The pump SDK's ESM build imports a named export from @coral-xyz/anchor that Node cannot resolve
// from anchor's CommonJS build, so every Solana package is loaded through its CommonJS build here.
// Loading them all one way also keeps a single copy of web3.js classes in the process.
const require = createRequire(import.meta.url);

export const pump: typeof PumpSdk = require("@pump-fun/pump-sdk");
export const swap: typeof PumpSwapSdk = require("@pump-fun/pump-swap-sdk");
export const web3: typeof Web3 = require("@solana/web3.js");
export const splToken: typeof SplToken = require("@solana/spl-token");
