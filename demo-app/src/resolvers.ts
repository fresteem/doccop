/**
 * Sample EntityResolvers for the demo. Three scopes:
 *
 * - `party_a` — internal organisation (the host's company), values hard-coded
 *   for the demo. In production this would query your organisations DB
 *   filtered by `ctx.parties.party_a.entityId`.
 * - `party_b` — external counterparty (client / supplier), values hard-coded
 *   for the demo. Production: query by `ctx.parties.party_b.entityId` with
 *   ACL filtering against `ctx.userId`.
 * - `system` — render-time computed values (today's date, the allocated
 *   contract number).
 *
 * Real resolvers return `{ kind: "absent" }` for missing keys rather than
 * throwing. Throwing is reserved for unexpected failures (DB unreachable,
 * etc.) — they bubble as RESOLVER_FAILED → 502 in @doccop/server.
 */

import type { EntityResolver, ResolveContext, ResolvedValue } from "@doccop/core";

const partyARecord: Record<string, Record<string, string>> = {
  "internal-acme": {
    full_name: "ТОВ «ACME Україна»",
    edrpou: "12345678",
    iban: "UA213996220000026007233566001",
    subtype: "TOV",
    address: "вул. Хрещатик, 1, м. Київ, 01001",
    director_name: "Іваненко Іван Іванович",
  },
};

const partyBRecord: Record<string, Record<string, string>> = {
  "external-clientx": {
    full_name: "ФОП Петренко Петро Петрович",
    edrpou: "1234567890",
    iban: "UA853052990000026003344556677",
    subtype: "FOP",
    address: "вул. Лесі Українки, 42, м. Львів, 79000",
    director_name: "Петренко Петро Петрович",
  },
  "external-tov": {
    full_name: "ТОВ «Промінь»",
    edrpou: "87654321",
    iban: "UA503006540000026000001234567",
    subtype: "TOV",
    address: "просп. Перемоги, 50, м. Харків, 61000",
    director_name: "Сидоренко Сергій Сергійович",
  },
};

export const partyAResolver: EntityResolver = {
  scope: "party_a",
  async resolve(key: string, ctx: ResolveContext): Promise<ResolvedValue> {
    const ref = ctx.parties.party_a;
    if (!ref) return { kind: "absent", reason: "no party_a in render request" };
    const record = partyARecord[ref.entityId];
    if (!record) return { kind: "absent", reason: `unknown party_a entity ${ref.entityId}` };
    const value = record[key];
    if (value === undefined) return { kind: "absent", reason: `unknown key party_a.${key}` };
    return { kind: "text", value };
  },
};

export const partyBResolver: EntityResolver = {
  scope: "party_b",
  async resolve(key: string, ctx: ResolveContext): Promise<ResolvedValue> {
    const ref = ctx.parties.party_b;
    if (!ref) return { kind: "absent", reason: "no party_b in render request" };
    const record = partyBRecord[ref.entityId];
    if (!record) return { kind: "absent", reason: `unknown party_b entity ${ref.entityId}` };
    const value = record[key];
    if (value === undefined) return { kind: "absent", reason: `unknown key party_b.${key}` };
    return { kind: "text", value };
  },
};

export const systemResolver: EntityResolver = {
  scope: "system",
  async resolve(key: string, ctx: ResolveContext): Promise<ResolvedValue> {
    switch (key) {
      case "today":
        return { kind: "text", value: ctx.meta.now.toISOString().slice(0, 10) };
      case "contract_number":
        return ctx.meta.documentNumber
          ? { kind: "text", value: ctx.meta.documentNumber }
          : { kind: "absent", reason: "documentNumber not allocated" };
      case "template_category":
        return ctx.meta.templateCategory
          ? { kind: "text", value: ctx.meta.templateCategory }
          : { kind: "absent", reason: "templateCategory unset" };
      default:
        return { kind: "absent", reason: `unknown system key ${key}` };
    }
  },
};

export const demoResolvers: EntityResolver[] = [partyAResolver, partyBResolver, systemResolver];
