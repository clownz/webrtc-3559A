/**
 * AUTO-GENERATED - DO NOT EDIT. Source: https://github.com/gpuweb/cts
 **/ import { compareQueries, Ordering } from './query/compare.js';
import {
  TestQueryMultiCase,
  TestQuerySingleCase,
  TestQueryMultiFile,
  TestQueryMultiTest,
} from './query/query.js';
import { kBigSeparator, kWildcard, kPathSeparator, kParamSeparator } from './query/separators.js';
import { stringifySingleParam } from './query/stringify_params.js';

import { assert, StacklessError } from './util/util.js';

// `loadTreeForQuery()` loads a TestTree for a given queryToLoad.
// The resulting tree is a linked-list all the way from `suite:*` to queryToLoad,
// and under queryToLoad is a tree containing every case matched by queryToLoad.
//
// `subqueriesToExpand` influences the `collapsible` flag on nodes in the resulting tree.
// A node is considered "collapsible" if none of the subqueriesToExpand is a StrictSubset
// of that node.
//
// In WebKit/Blink-style web_tests, an expectation file marks individual cts.html "variants" as
// "Failure", "Crash", etc.
// By passing in the list of expectations as the subqueriesToExpand, we can programmatically
// subdivide the cts.html "variants" list to be able to implement arbitrarily-fine suppressions
// (instead of having to suppress entire test files, which would lose a lot of coverage).
//
// `iterateCollapsedQueries()` produces the list of queries for the variants list.
//
// Though somewhat complicated, this system has important benefits:
//   - Avoids having to suppress entire test files, which would cause large test coverage loss.
//   - Minimizes the number of page loads needed for fine-grained suppressions.
//     (In the naive case, we could do one page load per test case - but the test suite would
//     take impossibly long to run.)
//   - Enables developers to put any number of tests in one file as appropriate, without worrying
//     about expectation granularity.

export class TestTree {
  constructor(root) {
    this.root = root;
  }

  iterateCollapsedQueries(includeEmptySubtrees) {
    return TestTree.iterateSubtreeCollapsedQueries(this.root, includeEmptySubtrees);
  }

  iterateLeaves() {
    return TestTree.iterateSubtreeLeaves(this.root);
  }

  /**
   * If a parent and its child are at different levels, then
   * generally the parent has only one child, i.e.:
   *   a,* { a,b,* { a,b:* { ... } } }
   * Collapse that down into:
   *   a,* { a,b:* { ... } }
   * which is less needlessly verbose when displaying the tree in the standalone runner.
   */
  dissolveLevelBoundaries() {
    const newRoot = dissolveSingleChildTrees(this.root);
    assert(newRoot === this.root);
  }

  toString() {
    return TestTree.subtreeToString('(root)', this.root, '');
  }

  static *iterateSubtreeCollapsedQueries(subtree, includeEmptySubtrees) {
    for (const [, child] of subtree.children) {
      if ('children' in child) {
        // Is a subtree
        if (child.children.size > 0 && !child.collapsible) {
          yield* TestTree.iterateSubtreeCollapsedQueries(child, includeEmptySubtrees);
        } else if (child.children.size > 0 || includeEmptySubtrees) {
          // Don't yield empty subtrees (e.g. files with no tests) unless includeEmptySubtrees
          yield child.query;
        }
      } else {
        // Is a leaf
        yield child.query;
      }
    }
  }

  static *iterateSubtreeLeaves(subtree) {
    for (const [, child] of subtree.children) {
      if ('children' in child) {
        yield* TestTree.iterateSubtreeLeaves(child);
      } else {
        yield child;
      }
    }
  }

  static subtreeToString(name, tree, indent) {
    const collapsible = 'run' in tree ? '>' : tree.collapsible ? '+' : '-';
    let s = indent + `${collapsible} ${JSON.stringify(name)} => ${tree.query}`;
    if ('children' in tree) {
      if (tree.description !== undefined) {
        s += `\n${indent}  | ${JSON.stringify(tree.description)}`;
      }

      for (const [name, child] of tree.children) {
        s += '\n' + TestTree.subtreeToString(name, child, indent + '  ');
      }
    }
    return s;
  }
}

// TODO: Consider having subqueriesToExpand actually impact the depth-order of params in the tree.
export async function loadTreeForQuery(loader, queryToLoad, subqueriesToExpand) {
  const suite = queryToLoad.suite;
  const specs = await loader.listing(suite);

  const subqueriesToExpandEntries = Array.from(subqueriesToExpand.entries());
  const seenSubqueriesToExpand = new Array(subqueriesToExpand.length);
  seenSubqueriesToExpand.fill(false);

  const isCollapsible = subquery =>
    subqueriesToExpandEntries.every(([i, toExpand]) => {
      const ordering = compareQueries(toExpand, subquery);

      // If toExpand == subquery, no expansion is needed (but it's still "seen").
      if (ordering === Ordering.Equal) seenSubqueriesToExpand[i] = true;
      return ordering !== Ordering.StrictSubset;
    });

  // L0 = suite-level, e.g. suite:*
  // L1 =  file-level, e.g. suite:a,b:*
  // L2 =  test-level, e.g. suite:a,b:c,d:*
  // L3 =  case-level, e.g. suite:a,b:c,d:
  let foundCase = false;
  // L0 is suite:*
  const subtreeL0 = makeTreeForSuite(suite);
  isCollapsible(subtreeL0.query); // mark seenSubqueriesToExpand
  for (const entry of specs) {
    if (entry.file.length === 0 && 'readme' in entry) {
      // Suite-level readme.
      assert(subtreeL0.description === undefined);
      subtreeL0.description = entry.readme.trim();
      continue;
    }

    {
      const queryL1 = new TestQueryMultiFile(suite, entry.file);
      const orderingL1 = compareQueries(queryL1, queryToLoad);
      if (orderingL1 === Ordering.Unordered) {
        // File path is not matched by this query.
        continue;
      }
    }

    if ('readme' in entry) {
      // Entry is a README that is an ancestor or descendant of the query.
      // (It's included for display in the standalone runner.)

      // Mark any applicable subqueriesToExpand as seen.
      isCollapsible(new TestQueryMultiFile(suite, entry.file));

      // readmeSubtree is suite:a,b,*
      // (This is always going to dedup with a file path, if there are any test spec files under
      // the directory that has the README).
      const readmeSubtree = addSubtreeForDirPath(subtreeL0, entry.file);

      assert(readmeSubtree.description === undefined);
      readmeSubtree.description = entry.readme.trim();
      continue;
    }
    // Entry is a spec file.

    const spec = await loader.importSpecFile(queryToLoad.suite, entry.file);
    const description = spec.description.trim();
    // subtreeL1 is suite:a,b:*
    const subtreeL1 = addSubtreeForFilePath(subtreeL0, entry.file, description, isCollapsible);

    for (const t of spec.g.iterate()) {
      {
        const queryL2 = new TestQueryMultiCase(suite, entry.file, t.testPath, {});
        const orderingL2 = compareQueries(queryL2, queryToLoad);
        if (orderingL2 === Ordering.Unordered) {
          // Test path is not matched by this query.
          continue;
        }
      }

      // subtreeL2 is suite:a,b:c,d:*
      const subtreeL2 = addSubtreeForTestPath(
        subtreeL1,
        t.testPath,
        t.description,
        t.testCreationStack,
        isCollapsible
      );

      // TODO: If tree generation gets too slow, avoid actually iterating the cases in a file
      // if there's no need to (based on the subqueriesToExpand).
      for (const c of t.iterate()) {
        {
          const queryL3 = new TestQuerySingleCase(suite, entry.file, c.id.test, c.id.params);
          const orderingL3 = compareQueries(queryL3, queryToLoad);
          if (orderingL3 === Ordering.Unordered || orderingL3 === Ordering.StrictSuperset) {
            // Case is not matched by this query.
            continue;
          }
        }

        // Leaf for case is suite:a,b:c,d:x=1;y=2
        addLeafForCase(subtreeL2, c, isCollapsible);

        foundCase = true;
      }
    }
  }

  for (const [i, sq] of subqueriesToExpandEntries) {
    const subquerySeen = seenSubqueriesToExpand[i];
    if (!subquerySeen) {
      throw new StacklessError(
        `subqueriesToExpand entry did not match anything \
(could be wrong, or could be redundant with a previous subquery):\n  ${sq.toString()}`
      );
    }
  }
  assert(foundCase, 'Query does not match any cases');

  return new TestTree(subtreeL0);
}

function makeTreeForSuite(suite) {
  return {
    readableRelativeName: suite + kBigSeparator,
    query: new TestQueryMultiFile(suite, []),
    children: new Map(),
    collapsible: false,
  };
}

function addSubtreeForDirPath(tree, file) {
  const subqueryFile = [];
  // To start, tree is suite:*
  // This loop goes from that -> suite:a,* -> suite:a,b,*
  for (const part of file) {
    subqueryFile.push(part);
    tree = getOrInsertSubtree(part, tree, () => {
      const query = new TestQueryMultiFile(tree.query.suite, subqueryFile);
      return { readableRelativeName: part + kPathSeparator + kWildcard, query, collapsible: false };
    });
  }
  return tree;
}

function addSubtreeForFilePath(tree, file, description, checkCollapsible) {
  // To start, tree is suite:*
  // This goes from that -> suite:a,* -> suite:a,b,*
  tree = addSubtreeForDirPath(tree, file);
  // This goes from that -> suite:a,b:*
  const subtree = getOrInsertSubtree('', tree, () => {
    const query = new TestQueryMultiTest(tree.query.suite, tree.query.filePathParts, []);
    assert(file.length > 0, 'file path is empty');
    return {
      readableRelativeName: file[file.length - 1] + kBigSeparator + kWildcard,
      query,
      description,
      collapsible: checkCollapsible(query),
    };
  });
  return subtree;
}

function addSubtreeForTestPath(tree, test, description, testCreationStack, isCollapsible) {
  const subqueryTest = [];
  // To start, tree is suite:a,b:*
  // This loop goes from that -> suite:a,b:c,* -> suite:a,b:c,d,*
  for (const part of test) {
    subqueryTest.push(part);
    tree = getOrInsertSubtree(part, tree, () => {
      const query = new TestQueryMultiTest(
        tree.query.suite,
        tree.query.filePathParts,
        subqueryTest
      );

      return {
        readableRelativeName: part + kPathSeparator + kWildcard,
        query,
        collapsible: isCollapsible(query),
      };
    });
  }
  // This goes from that -> suite:a,b:c,d:*
  return getOrInsertSubtree('', tree, () => {
    const query = new TestQueryMultiCase(
      tree.query.suite,
      tree.query.filePathParts,
      subqueryTest,
      {}
    );

    assert(subqueryTest.length > 0, 'subqueryTest is empty');
    return {
      readableRelativeName: subqueryTest[subqueryTest.length - 1] + kBigSeparator + kWildcard,
      kWildcard,
      query,
      description,
      testCreationStack,
      collapsible: isCollapsible(query),
    };
  });
}

function addLeafForCase(tree, t, checkCollapsible) {
  const query = tree.query;
  let name = '';
  const subqueryParams = {};

  // To start, tree is suite:a,b:c,d:*
  // This loop goes from that -> suite:a,b:c,d:x=1;* -> suite:a,b:c,d:x=1;y=2;*
  for (const [k, v] of Object.entries(t.id.params)) {
    name = stringifySingleParam(k, v);
    subqueryParams[k] = v;

    tree = getOrInsertSubtree(name, tree, () => {
      const subquery = new TestQueryMultiCase(
        query.suite,
        query.filePathParts,
        query.testPathParts,
        subqueryParams
      );

      return {
        readableRelativeName: name + kParamSeparator + kWildcard,
        query: subquery,
        collapsible: checkCollapsible(subquery),
      };
    });
  }

  // This goes from that -> suite:a,b:c,d:x=1;y=2
  const subquery = new TestQuerySingleCase(
    query.suite,
    query.filePathParts,
    query.testPathParts,
    subqueryParams
  );

  checkCollapsible(subquery); // mark seenSubqueriesToExpand
  insertLeaf(tree, subquery, t);
}

function getOrInsertSubtree(key, parent, createSubtree) {
  let v;
  const child = parent.children.get(key);
  if (child !== undefined) {
    assert('children' in child); // Make sure cached subtree is not actually a leaf
    v = child;
  } else {
    v = { ...createSubtree(), children: new Map() };
    parent.children.set(key, v);
  }
  return v;
}

function insertLeaf(parent, query, t) {
  const key = '';
  const leaf = {
    readableRelativeName: readableNameForCase(query),
    query,
    run: (rec, expectations) => t.run(rec, query, expectations || []),
  };

  assert(!parent.children.has(key));
  parent.children.set(key, leaf);
}

function dissolveSingleChildTrees(tree) {
  if ('children' in tree) {
    const shouldDissolveThisTree =
      tree.children.size === 1 && tree.query.depthInLevel !== 0 && tree.description === undefined;
    if (shouldDissolveThisTree) {
      // Loops exactly once
      for (const [, child] of tree.children) {
        // Recurse on child
        return dissolveSingleChildTrees(child);
      }
    }

    for (const [k, child] of tree.children) {
      // Recurse on each child
      const newChild = dissolveSingleChildTrees(child);
      if (newChild !== child) {
        tree.children.set(k, newChild);
      }
    }
  }
  return tree;
}

/** Generate a readable relative name for a case (used in standalone). */
function readableNameForCase(query) {
  const paramsKeys = Object.keys(query.params);
  if (paramsKeys.length === 0) {
    return query.testPathParts[query.testPathParts.length - 1] + kBigSeparator;
  } else {
    const lastKey = paramsKeys[paramsKeys.length - 1];
    return stringifySingleParam(lastKey, query.params[lastKey]);
  }
}
