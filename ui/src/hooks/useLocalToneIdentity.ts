import { useEffect, useRef } from 'react';
import type { ChainItem, ToneBlock } from '../types/chain';
import { isInsertSlot } from '../types/chain';
import type { T3KClient } from '../t3k/tone3000-client';
import { T3K_API } from '../t3k/config';
import {
  adoptedToneJson,
  bytesMatchStash,
  namIdentityOf,
  pickCandidateTones,
  pickModel,
  stashAddressOf,
} from '../t3k/localToneIdentity';

/**
 * Gives locally loaded `.nam` blocks their catalog identity back.
 *
 * Watching chain state rather than hooking a load path is deliberate: local
 * files arrive by drop (through the UI), by the tile menus' Load File /
 * Load Folder (native only, never touching the UI), and by state restore.
 * One effect covers all three, and re-runs cost nothing because an adopted
 * block has artwork and is skipped.
 *
 * Everything here is best-effort and off the load path: a block plays the
 * moment it loads, artwork or not, and every failure just leaves the file
 * glyph. Each distinct file is attempted once per session (`attempted`), so
 * a miss or an outage never turns into repeat traffic.
 */
export function useLocalToneIdentity(
  chain: ChainItem[],
  chainRight: ChainItem[] | null,
  client: T3KClient,
  authenticated: boolean,
  refreshToneMetadata: (toneJson: string, blockId?: string) => void
) {
  const attempted = useRef(new Set<string>());
  // The effect reads these but must not re-run when they change identity.
  const latest = useRef({ client, refreshToneMetadata });
  latest.current = { client, refreshToneMetadata };

  useEffect(() => {
    if (!authenticated) return;
    console.log('[lti] effect', chain.length, chainRight?.length ?? 0);

    // A local single-file block with no artwork yet. Keyed by the model's
    // stash URL, which is content-addressed: swapping a different file into
    // the same block is a new question, re-asking about the same bytes is
    // not. There is deliberately no cancellation here -- chain state changes
    // several times while a file loads, and aborting on each one would
    // cancel the lookup that the load itself just triggered. Adoption is a
    // native metadata write, safe to land late.
    const pending = [...chain, ...(chainRight ?? [])]
      .filter((item): item is ToneBlock => !isInsertSlot(item))
      .filter(
        (b) =>
          b.tone.local === true &&
          !b.tone.images?.[0] &&
          b.tone.models?.length === 1 &&
          !!b.tone.models[0].model_url &&
          !attempted.current.has(b.tone.models[0].model_url)
      );

    const resolve = async (block: ToneBlock) => {
      const model = block.tone.models[0];
      const identity = namIdentityOf(model);
      const address = model.model_url ? stashAddressOf(model.model_url) : null;
      console.log('[lti] resolve', block.blockId, model.model_url, JSON.stringify(identity), address);
      if (!identity || !address) return;

      const { client: t3k, refreshToneMetadata: refresh } = latest.current;

      const found = await t3k.searchTones(identity.name);
      console.log('[lti] search', identity.name, found.data?.length ?? 0, JSON.stringify((found.data ?? []).map((t) => [t.id, t.user?.username, t.title])));
      for (const tone of pickCandidateTones(found.data ?? [], identity)) {
        const models = await t3k.listModels(tone.id, { architecture: 2, pageSize: 100 });
        const candidate = pickModel(models.data ?? [], identity);
        console.log('[lti] tone', tone.id, 'models', models.data?.length ?? 0, 'candidate', candidate?.model_url);
        if (!candidate?.model_url?.startsWith(T3K_API)) continue;

        // The proof: the catalog's bytes are this file's bytes. Downloaded
        // through the client so the Bearer rides along (the endpoint
        // redirects to public storage once authorized).
        const res = await t3k.fetch(candidate.model_url.slice(T3K_API.length));
        console.log('[lti] fetch', res.status, res.ok);
        if (!res.ok) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        const match = bytesMatchStash(bytes, address);
        console.log('[lti] bytes', bytes.length, 'match', match);
        if (!match) continue;

        console.log('[lti] adopt', tone.id);
        refresh(adoptedToneJson(tone), block.blockId);
        return;
      }
    };

    console.log('[lti] pending', pending.length);
    for (const item of [...chain, ...(chainRight ?? [])]) {
      if (isInsertSlot(item)) continue;
      const t = item.tone;
      console.log('[lti] block', item.blockId, 'local', t.local, 'img', !!t.images?.[0], 'models', t.models?.length, 'url', t.models?.[0]?.model_url, 'nam', t.models?.[0]?.nam_name, 'tried', !!(t.models?.[0]?.model_url && attempted.current.has(t.models[0].model_url)));
    }
    for (const block of pending) {
      attempted.current.add(block.tone.models[0].model_url!);
      resolve(block).catch((err) => {
        // Offline, signed out mid-flight, tone gone private: the block keeps
        // its file glyph and plays exactly as before.
        console.log('[lti] skipped', String(err));
      });
    }
  }, [chain, chainRight, authenticated]);
}
