// Copyright 2017 The Chromium Authors. All rights reserved.
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

(async function() {
  TestRunner.addResult(
      `Tests that console shows messages only from specific context when show target checkbox is checked.\n`);
  await TestRunner.loadModule('console'); await TestRunner.loadTestModule('console_test_runner');
  await TestRunner.showPanel('console');
  await TestRunner.evaluateInPagePromise(`
      console.log("message from page!");
  `);
  await TestRunner.addIframe('resources/console-show-all-messages-iframe.html', {
    name: 'myIFrame'
  });

  var filterByExecutionContextSetting = Console.ConsoleView.instance()._filter._filterByExecutionContextSetting;
  Console.ConsoleView.instance()._setImmediatelyFilterMessagesForTest();

  //we can't use usual ConsoleTestRunner.dumpConsoleMessages(), because it dumps url of message and it flakes in case of iframe
  function dumpVisibleConsoleMessageText() {
    var messageViews = Console.ConsoleView.instance()._visibleViewMessages;
    for (var i = 0; i < messageViews.length; ++i) {
      TestRunner.addResult(messageViews[i].consoleMessage().messageText);
    }
  }

  TestRunner.runTestSuite([

    function testInitialState(next) {
      if (filterByExecutionContextSetting.get())
        TestRunner.addResult('"Show target messages" checkbox should be unchecked by default');
      dumpVisibleConsoleMessageText();
      next();
    },

    function testPageOnlyMessages(next) {
      ConsoleTestRunner.changeExecutionContext('top');
      filterByExecutionContextSetting.set(true);
      dumpVisibleConsoleMessageText();
      next();
    },

    function testFrameOnlyMessages(next) {
      ConsoleTestRunner.changeExecutionContext('myIFrame');
      dumpVisibleConsoleMessageText();
      next();
    },

    function testAllMessagesWithFrameContext(next) {
      filterByExecutionContextSetting.set(false);
      dumpVisibleConsoleMessageText();
      next();
    }
  ]);
})();
