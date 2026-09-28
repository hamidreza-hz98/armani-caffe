import "server-only";

import { runSafeAction } from "../../../server/actions.ts";
import type { MediaService } from "../application/service.ts";
import type { MediaActor } from "../contracts/media.ts";

/** Use from thin authenticated 'use server' wrappers; never accept actors from Client Components. */
export function createMediaActions(
  service: MediaService,
  authenticate: () => Promise<MediaActor | null>,
) {
  return {
    initiate: (key: string, input: unknown) =>
      runSafeAction("media.initiate", async () =>
        service.initiate(await authenticate(), key, input),
      ),
    initiateBulk: (key: string, inputs: unknown) =>
      runSafeAction("media.initiateBulk", async () =>
        service.initiateBulk(await authenticate(), key, inputs),
      ),
    complete: (id: string) =>
      runSafeAction("media.complete", async () => service.complete(await authenticate(), id)),
    completeBulk: (ids: unknown) =>
      runSafeAction("media.completeBulk", async () =>
        service.completeBulk(await authenticate(), ids),
      ),
    update: (id: string, key: string, revision: number, metadata: unknown) =>
      runSafeAction("media.update", async () =>
        service.update(await authenticate(), id, key, revision, metadata),
      ),
    delete: (id: string, key: string) =>
      runSafeAction("media.delete", async () => service.delete(await authenticate(), id, key)),
    replace: (id: string, target: string, key: string) =>
      runSafeAction("media.replace", async () =>
        service.replace(await authenticate(), id, target, key),
      ),
  };
}
