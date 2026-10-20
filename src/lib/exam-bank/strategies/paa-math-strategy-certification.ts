/**
 * The certification record of the PAA Mathematics speed-strategy families. WRITTEN BY
 * scripts/operations/exam-bank/certify-speed-strategies.ts -- never by hand.
 *
 * A family is deliverable only while its digest is the one recorded here. An edited family has another digest and
 * is a CANDIDATE again until the script is run and every gate passes for it.
 */
export const PAA_SPEED_STRATEGY_POLICY = { policyId: 'PAA_SPEED_STRATEGY_PILOT_POLICY', version: 'V1', decidedBy: 'policy:PAA_SPEED_STRATEGY_PILOT_POLICY_V1', grantsScopes: ['PILOT_PREVIEW'] as const, state: 'AUTOMATED_CERTIFIED_PILOT' as const } as const;
export const PAA_MATH_STRATEGY_CERTIFICATION: Readonly<Record<string, { strategyVersion: number; strategyDigest: string; itemsProven: number }>> = {
  "strat.paa.mat.slope.two-points": {
    "strategyVersion": 1,
    "strategyDigest": "0cfd9d193fe8d405f70b932015e8b034977da06ee8806729e7c318f8935e66db",
    "itemsProven": 30
  },
  "strat.paa.mat.linear.two-steps": {
    "strategyVersion": 1,
    "strategyDigest": "9b283aa9ca8dcc69cdfaa02b00f8f86214931bdef0b2fec14826cdde04048b33",
    "itemsProven": 10
  },
  "strat.paa.mat.linear.collect": {
    "strategyVersion": 1,
    "strategyDigest": "23876214530e424cc25c9449e9e96a89b17de4fd652273d68c07a92c89d8ae4b",
    "itemsProven": 10
  },
  "strat.paa.mat.linear.parentheses": {
    "strategyVersion": 1,
    "strategyDigest": "5890aac63c020f69673b2cd505721522c3ea2ca606c8f82bbd0c61b1802da1a7",
    "itemsProven": 10
  },
  "strat.paa.mat.system.add-opposite-y": {
    "strategyVersion": 1,
    "strategyDigest": "7869d43772c536ce29d394fae84ac03636db0f64103c33034857db78a258911e",
    "itemsProven": 20
  },
  "strat.paa.mat.system.eliminate-y": {
    "strategyVersion": 1,
    "strategyDigest": "d30b73f7e34e31d05a5ffb88b4aba03a05aef6001abde92d760cc88189e08a7d",
    "itemsProven": 10
  },
  "strat.paa.mat.quadratic.factor": {
    "strategyVersion": 1,
    "strategyDigest": "428b7d75359e18e96cfa67ce3279278906dc2e2f3287c155d605a0572e71a47e",
    "itemsProven": 10
  },
  "strat.paa.mat.quadratic.rearrange-factor": {
    "strategyVersion": 1,
    "strategyDigest": "b7da25d955a240b94c710dcfac1a6ea4c691da8d73b293d8bfa93b3ecfe5ef99",
    "itemsProven": 10
  },
  "strat.paa.mat.quadratic.expand-formula": {
    "strategyVersion": 1,
    "strategyDigest": "ab0f7a6115d0d0a263d9df7dab572769022e6348a9490510e44523fc2c2e8208",
    "itemsProven": 10
  },
  "strat.paa.mat.percent.of-quantity": {
    "strategyVersion": 1,
    "strategyDigest": "5cefb9fca6456f123743ceb3906bebda7f0e62040878da1f154ee130c856d2dc",
    "itemsProven": 10
  },
  "strat.paa.mat.percent.increase": {
    "strategyVersion": 1,
    "strategyDigest": "6a0e984693de9f90b3853ce3f4a0d65d6f608afa3ba62a5b28cd62c86ceb8d3b",
    "itemsProven": 10
  },
  "strat.paa.mat.percent.original": {
    "strategyVersion": 1,
    "strategyDigest": "e3d740ae1620f508c6419c2e7267f53c5bdf5ded609670851554d15d80aaa6c3",
    "itemsProven": 10
  },
  "strat.paa.mat.proportion.scale": {
    "strategyVersion": 1,
    "strategyDigest": "99f6df5f9981232479aa9798d87ba091759a68d0e75e764c24ce8d04c47b350d",
    "itemsProven": 10
  },
  "strat.paa.mat.proportion.convert-units": {
    "strategyVersion": 1,
    "strategyDigest": "2c19a816bcaf04bb7dc6bfaad82bfe2370f5feb89034b31c883de5661daefff5",
    "itemsProven": 20
  },
  "strat.paa.mat.mean.pivot": {
    "strategyVersion": 1,
    "strategyDigest": "f43f02dcb22780c912ab2651ab84bc363809d3d8772676f497d29360c64192de",
    "itemsProven": 6
  },
  "strat.paa.mat.mean.missing": {
    "strategyVersion": 1,
    "strategyDigest": "6332fa8258519a891e3db2609b419e2717ba8d0c739286dcbcbc5a968a79c072",
    "itemsProven": 10
  },
  "strat.paa.mat.mean.added-value": {
    "strategyVersion": 1,
    "strategyDigest": "9e68380202f29a1c00fe53118a2af1acb87cd8b6340fde09f7afdaf125a4977b",
    "itemsProven": 10
  },
  "strat.paa.mat.right-triangle.triples": {
    "strategyVersion": 1,
    "strategyDigest": "24409835ecc7398e166471b1a03df0c422f2321028a5460b414e6a2dd901dcd9",
    "itemsProven": 30
  },
  "strat.paa.mat.rectangle.area": {
    "strategyVersion": 1,
    "strategyDigest": "20b5b84597069955eae610a8b71c72ee76d9232ba7ae751a5d10fcae5eea02c0",
    "itemsProven": 10
  },
  "strat.paa.mat.rectangle.from-perimeter": {
    "strategyVersion": 1,
    "strategyDigest": "af758c0cfa20df40234560b56b2d1a248cefef365eaa6306cbb6f67b4b1772a5",
    "itemsProven": 10
  },
  "strat.paa.mat.rectangle.from-area": {
    "strategyVersion": 1,
    "strategyDigest": "8f270c2b36df7f85ed380e0ddf06acf6bf7e618b144ad42b46346a34f04f6ff2",
    "itemsProven": 10
  },
  "strat.paa.mat.probability.single": {
    "strategyVersion": 1,
    "strategyDigest": "34bba7ffdf156f4eff489113e91538bff42e28553fb1ee6dc21759e1ef65126a",
    "itemsProven": 10
  },
  "strat.paa.mat.probability.not": {
    "strategyVersion": 1,
    "strategyDigest": "f3eca43407738c59a7636344bfd1cda967d547240c2eb7864d98b7a30289118e",
    "itemsProven": 10
  },
  "strat.paa.mat.probability.or": {
    "strategyVersion": 1,
    "strategyDigest": "8e5b010e23695b0337af993115177bd4c3d70d96d189c9752df3f8e03676a994",
    "itemsProven": 10
  }
};
