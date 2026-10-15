export interface CliOptions {
	demo: boolean;
	replayFile: string | null;
	record: boolean;
	speed: number;
	port: number | null;
	staticDir: string | null;
	dataDir: string | null;
}

export function parsePort(value: string, name: string): number {
	const port = Number(value);
	if (!/^\d+$/.test(value) || port > 65_535) throw new Error(`${name} must be an integer from 0 to 65535`);
	return port;
}

export function parseArgs(argv: readonly string[]): CliOptions {
	const options: CliOptions = {
		demo: false,
		replayFile: null,
		record: false,
		speed: 1,
		port: null,
		staticDir: null,
		dataDir: null,
	};
	const value = (index: number, flag: string): string => {
		const next = argv[index + 1];
		if (next === undefined || next.startsWith("--")) throw new Error(`${flag} needs a value`);
		return next;
	};
	for (let i = 0; i < argv.length; i++) {
		const flag = argv[i];
		switch (flag) {
			case "--demo":
				options.demo = true;
				break;
			case "--record":
				options.record = true;
				break;
			case "--replay":
				options.replayFile = value(i++, flag);
				break;
			case "--speed": {
				const speed = Number(value(i++, flag));
				if (!Number.isFinite(speed) || speed <= 0) throw new Error("--speed must be a positive number");
				options.speed = speed;
				break;
			}
			case "--port":
				options.port = parsePort(value(i++, flag), "--port");
				break;
			case "--static-dir":
				options.staticDir = value(i++, flag);
				break;
			case "--data-dir":
				options.dataDir = value(i++, flag);
				break;
			default:
				throw new Error(`Unknown option: ${flag}`);
		}
	}
	if (options.demo && options.replayFile !== null) throw new Error("Use either --demo or --replay, not both");
	if (options.speed !== 1 && !options.demo && options.replayFile === null)
		throw new Error("--speed only applies to --demo and --replay");
	return options;
}
