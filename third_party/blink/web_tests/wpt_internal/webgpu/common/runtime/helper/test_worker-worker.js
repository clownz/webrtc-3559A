/**
 * AUTO-GENERATED - DO NOT EDIT. Source: https://github.com/gpuweb/cts
 **/ import { DefaultTestFileLoader } from '../../framework/file_loader.js';
import { Logger } from '../../framework/logging/logger.js';
import { parseQuery } from '../../framework/query/parseQuery.js';

import { assert } from '../../framework/util/util.js';

// should be DedicatedWorkerGlobalScope

const loader = new DefaultTestFileLoader();

self.onmessage = async ev => {
  const query = ev.data.query;
  const expectations = ev.data.expectations;
  const debug = ev.data.debug;

  const log = new Logger(debug);

  const testcases = Array.from(await loader.loadCases(parseQuery(query)));
  assert(testcases.length === 1, 'worker query resulted in != 1 cases');

  const testcase = testcases[0];
  const [rec, result] = log.record(testcase.query.toString());
  await testcase.run(rec, expectations);

  self.postMessage({ query, result });
};
