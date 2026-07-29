/**
 * GENERATED FILE — do not edit by hand. Run `pnpm generate`.
 *
 * The deployment record Workers embed. A Worker has no filesystem and cannot read a manifest at
 * runtime, so this module is compiled into the bundle. Each environment carries a manifestHash,
 * which every Worker reports at /config — a Worker running a stale bundle is therefore detectable
 * rather than silently wrong.
 *
 * TIMESTAMP POLICY: none, deliberately. See any generated ABI module.
 */

export interface EmbeddedDeployment {
  readonly environment: string;
  readonly chainId: number;
  readonly deploymentBlock: string;
  readonly manifestHash: string;
  readonly contracts: Readonly<Record<string, string>>;
  readonly markets: ReadonlyArray<{ key: string; id: string; rateGridHash: string }>;
  readonly midnightRelease: string;
  readonly midnightCommit: string;
  readonly verifiedSourceCount: number;
}

export const DEPLOYMENTS: Readonly<Record<string, EmbeddedDeployment>> = {
  "local": {
    "environment": "local",
    "chainId": 31337,
    "deploymentBlock": "26",
    "manifestHash": "sha256:c1e7c9071c9ad0035095dd0f92dd90d0eaffe1230931be9dadd87c7a267a8ce3",
    "contracts": {
      "KyrveDeploymentVerifier": "0x4A679253410272dd5232B3Ff7cF5dbB88f295319",
      "KyrveOsakaProbe": "0x322813Fd9A801c5507c9de605d63CEA4f2CE6c44",
      "KyrveProtocolRegistry": "0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f",
      "Midnight": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
      "TestUSDC": "0x0165878A594ca255338adfa4d48449f69242Eb8F",
      "TestWETH": "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853",
      "TestWstETH": "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6",
      "WethOracle": "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318",
      "WstethOracle": "0x610178dA211FEF7D417bC0e6FeD39F05609AD788"
    },
    "markets": [
      {
        "key": "usdc-30d-weth",
        "id": "0x45de7986b59233ae943f9c94f8c2487851219d85984b878e2d2d2041c278fe31",
        "rateGridHash": "0xb9465f3e68188a2b9b750cdf70a354fb138a0a5919d797af360a5927c6c458db"
      },
      {
        "key": "usdc-90d-weth",
        "id": "0x588b948019978d9168c5d25b890249989bf715d1fb61816990495fc2bbd3a9f0",
        "rateGridHash": "0x840069a1fb7df9f20317cdff292ddd97290e74d28d12771510bbbde15c013019"
      },
      {
        "key": "usdc-30d-wsteth",
        "id": "0x6aa53c3ce2028f72f8bd30375046a65ed9523547429d83b8b90b898b19582142",
        "rateGridHash": "0x7a9cd05ace11c0cc29ab8600e50f0dc7e4a11f06faa897ea3a17c61b493e7d30"
      },
      {
        "key": "usdc-90d-multi",
        "id": "0x0d9cbb561a77fdb2fb5881007c9287488e2fa537936d01ae831354dd3e35bef0",
        "rateGridHash": "0xeae235bfd080419d9383f24f152cf7a78be274ffb16f237170c1273288ff9bd4"
      }
    ],
    "midnightRelease": "2026-07-23",
    "midnightCommit": "dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0",
    "verifiedSourceCount": 0
  },
  "sepolia": {
    "environment": "sepolia",
    "chainId": 11155111,
    "deploymentBlock": "11373556",
    "manifestHash": "sha256:eef8e903eccffb93a93215eaea37a7964020a131427d82c77fdf5b72bbcbaad9",
    "contracts": {
      "KyrveDeploymentVerifier": "0xa7D60Be81889777C54CB1AF4afAe8FaBFe8C20e0",
      "KyrveOsakaProbe": "0xbbec3e83090F764bB7C55006042aa0438cF6974A",
      "KyrveProtocolRegistry": "0xB7790e3f28eD688C81f09C0Cad72f7f45f4D3957",
      "Midnight": "0xA8774FEba7DDCAdcE4C299c3EC376B8ef447B2d7",
      "TestUSDC": "0x0257E18aA1a631864aaF1DCedC6b5741C96A1eF9",
      "TestWETH": "0x900777F598CBcb440dBcdfC2007E379F3374D61C",
      "TestWstETH": "0x6200312Afb642782530D423E3ad2b233357d0417",
      "WethOracle": "0xc284dF918bC120C66996746692DaC67696A131A8",
      "WstethOracle": "0x812c49bA623765C23E42Aba4fEd8d33D21027F5f"
    },
    "markets": [
      {
        "key": "usdc-30d-weth",
        "id": "0x10e4bf7d5d586cee190fcd15c4ba68fd24a9b738068fbac2534568718678196a",
        "rateGridHash": "0xb9465f3e68188a2b9b750cdf70a354fb138a0a5919d797af360a5927c6c458db"
      },
      {
        "key": "usdc-90d-weth",
        "id": "0xd3cb37a754429601735a16349771482103c5dc40848b51970c4dcec6241163e6",
        "rateGridHash": "0x840069a1fb7df9f20317cdff292ddd97290e74d28d12771510bbbde15c013019"
      },
      {
        "key": "usdc-30d-wsteth",
        "id": "0xe36e890864679677d9d1e2817574d61e0c8ae42a6329251cd01f93b743bb4a81",
        "rateGridHash": "0x7a9cd05ace11c0cc29ab8600e50f0dc7e4a11f06faa897ea3a17c61b493e7d30"
      },
      {
        "key": "usdc-90d-multi",
        "id": "0x97870262408061213d3753437dcec435b340c6bfb8d3c7f4ff3ce3f208adfebc",
        "rateGridHash": "0xeae235bfd080419d9383f24f152cf7a78be274ffb16f237170c1273288ff9bd4"
      }
    ],
    "midnightRelease": "2026-07-23",
    "midnightCommit": "dbd8d3d54d324a03df9f06d3c77d50a7bd1e09a0",
    "verifiedSourceCount": 9
  }
} as const;

export const DEPLOYMENT_ENVIRONMENTS = ["local","sepolia"] as const;

/** Throws rather than returning undefined: a Worker with no deployment must fail loudly. */
export function embeddedDeployment(environment: string): EmbeddedDeployment {
  const record = DEPLOYMENTS[environment];
  if (record === undefined) {
    throw new Error(
      `no embedded deployment for "${environment}". Available: ${DEPLOYMENT_ENVIRONMENTS.join(", ")}. ` +
        "Deploy it and run `pnpm generate` so the record is compiled into the bundle.",
    );
  }
  return record;
}
