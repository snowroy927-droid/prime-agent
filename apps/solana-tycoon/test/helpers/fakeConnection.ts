import type {
	AccountChangeCallback,
	AccountInfo,
	Context,
	PublicKey,
	RpcResponseAndContext,
	TokenAccountBalancePair,
	TokenAmount,
} from "@solana/web3.js";
import type { ChainConnection } from "../../src/engine/chain/types";

export class FakeConnection implements ChainConnection {
	readonly accounts = new Map<string, AccountInfo<Buffer>>();
	readonly calls: { method: string; keys: string[] }[] = [];
	slot = 100;
	failNext = 0;
	largest: TokenAccountBalancePair[] = [];
	supply = "1000000000000000";
	private readonly listeners = new Map<number, { key: string; callback: AccountChangeCallback }>();
	private nextId = 1;

	set(key: PublicKey, info: AccountInfo<Buffer> | null): void {
		if (info) this.accounts.set(key.toBase58(), info);
		else this.accounts.delete(key.toBase58());
	}

	listenerCount(): number {
		return this.listeners.size;
	}

	push(key: PublicKey, info: AccountInfo<Buffer>, slot: number): void {
		for (const listener of this.listeners.values()) {
			if (listener.key === key.toBase58()) listener.callback(info, { slot });
		}
	}

	private record(method: string, keys: PublicKey[]): void {
		this.calls.push({ method, keys: keys.map((key) => key.toBase58()) });
		if (this.failNext > 0) {
			this.failNext -= 1;
			throw new Error(`${method} failed`);
		}
	}

	private context(): Context {
		return { slot: this.slot };
	}

	async getMultipleAccountsInfo(publicKeys: PublicKey[]): Promise<(AccountInfo<Buffer> | null)[]> {
		this.record("getMultipleAccountsInfo", publicKeys);
		return publicKeys.map((key) => this.accounts.get(key.toBase58()) ?? null);
	}

	async getMultipleAccountsInfoAndContext(
		publicKeys: PublicKey[],
	): Promise<RpcResponseAndContext<(AccountInfo<Buffer> | null)[]>> {
		this.record("getMultipleAccountsInfoAndContext", publicKeys);
		return { context: this.context(), value: publicKeys.map((key) => this.accounts.get(key.toBase58()) ?? null) };
	}

	async getAccountInfo(publicKey: PublicKey): Promise<AccountInfo<Buffer> | null> {
		this.record("getAccountInfo", [publicKey]);
		return this.accounts.get(publicKey.toBase58()) ?? null;
	}

	onAccountChange(publicKey: PublicKey, callback: AccountChangeCallback, _config?: unknown): number {
		const id = this.nextId++;
		this.listeners.set(id, { key: publicKey.toBase58(), callback });
		return id;
	}

	async removeAccountChangeListener(clientSubscriptionId: number): Promise<void> {
		this.listeners.delete(clientSubscriptionId);
	}

	async getTokenLargestAccounts(mintAddress: PublicKey): Promise<RpcResponseAndContext<TokenAccountBalancePair[]>> {
		this.record("getTokenLargestAccounts", [mintAddress]);
		return { context: this.context(), value: this.largest };
	}

	async getTokenSupply(tokenMintAddress: PublicKey): Promise<RpcResponseAndContext<TokenAmount>> {
		this.record("getTokenSupply", [tokenMintAddress]);
		return { context: this.context(), value: { amount: this.supply, decimals: 6, uiAmount: null } };
	}
}
