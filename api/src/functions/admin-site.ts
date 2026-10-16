import type { SiteStatus } from '../../../src/domain/api-types.ts';
import { db } from '../lib/db.ts';
import { HttpError } from '../lib/errors.ts';
import { deployConfigured, startDeploy } from '../lib/github.ts';
import { route } from '../lib/http.ts';
import { isBehind, siteState } from '../repo/site.ts';

route('adminSite', 'GET', 'admin/site', 'admin', async (ctx): Promise<SiteStatus> => {
  const state = await siteState(db);
  return {
    lastSnapshotAt: state.lastSnapshotAt?.toISOString() ?? null,
    behind: isBehind(state),
    deployConfigured: deployConfigured(ctx.config),
  };
});

route('adminSiteUpdate', 'POST', 'admin/site/update', 'admin', async (ctx) => {
  const result = await startDeploy(ctx.config);
  if (!result.started) {
    ctx.log.warn('The site deploy did not start:', result.message);
    throw new HttpError(502, result.message);
  }
  return result;
});
