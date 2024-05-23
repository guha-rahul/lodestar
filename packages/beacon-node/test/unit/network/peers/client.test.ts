import {describe, it, expect} from "vitest";
import {getKnownClientFromAgentVersion, ClientKind} from "../../../../src/network/peers/client.js";

describe("clientFromAgentVersion", () => {
  const testCases: {name: string; agentVersion: string; client: ClientKind | null}[] = [
    {
      name: "lighthouse",
      agentVersion: "Lighthouse/v2.0.1-fff01b2/x86_64-linux",
      client: ClientKind.Lighthouse,
    },
    {
      name: "teku",
      agentVersion: "teku/teku/v21.11.0+62-g501ffa7/linux-x86_64/corretto-java-17",
      client: ClientKind.Teku,
    },
    {
      name: "nimbus",
      agentVersion: "nimbus",
      client: ClientKind.Nimbus,
    },
    {
      name: "prysm",
      agentVersion: "Prysm/v2.0.2/a80b1c252a9b4773493b41999769bf3134ac373f",
      client: ClientKind.Prysm,
    },
    {
      name: "lodestar",
      agentVersion: "js-libp2p/0.32.4",
      client: ClientKind.Lodestar,
    },
    {
      name: "grandine",
      agentVersion: "Grandine/0.4.1-537713d/arm-linux",
      client: ClientKind.Grandine,
    },
    {
      name: "unknown client",
      agentVersion: "strange-client-agent-version",
      client: null,
    },
  ];

  for (const {name, agentVersion, client} of testCases) {
    it(name, () => {
      expect(getKnownClientFromAgentVersion(agentVersion)).toBe(client);
    });
  }
});
