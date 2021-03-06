const testcases = [
  {config_input: {}, value: "test", result: "test", message: "string"},
  {config_input: {}, value: "<b>bla</b>", result: "<b>bla</b>", message: "html fragment"},
  {config_input: {}, value: "<a<embla", result: "", message: "broken html"},
  {config_input: {}, value: {}, result: "[object Object]", message: "empty object"},
  {config_input: {}, value: 1, result: "1", message: "number"},
  {config_input: {}, value: 000, result: "0", message: "zeros"},
  {config_input: {}, value: 1+2, result: "3", message: "arithmetic"},
  {config_input: {}, value: "", result: "", message: "empty string"},
  {config_input: {}, value: undefined, result: "undefined", message: "undefined"},
  {config_input: {}, value: "<html><head></head><body>test</body></html>", result: "test", message: "document"},
  {config_input: {}, value: "<div>test", result: "<div>test</div>", message: "html without close tag"},
  {config_input: {}, value: "<script>alert('i am a test')<\/script>", result: "", message: "scripts for default configs"},
  {config_input: {}, value: "<p onclick='a= 123'>Click.</p>", result: "<p>Click.</p>", message: "onclick scripts"},
  {config_input: {}, value: "<plaintext><p>text</p>", result: "", message: "plaintext"},
  {config_input: {}, value: "<xmp>TEXT</xmp>", result: "", message: "xmp"},
  {config_input: {}, value: "<p>Some text</p></body><!-- 1 --></html><!-- 2 --><p>Some more text</p>", result: "<p>Some text</p><!-- 1 --><!-- 2 --><p>Some more text</p>", message: "malformed HTML"},
  {config_input: {test: 123}, value: "test", result: "test", message: "invalid config_input"},
  {config_input: {dropElements: []}, value: "test", result: "test", message: "empty dropElements list"},
  {config_input: {dropElements: ["div"]}, value: "<div>test</div><p>bla", result: "<p>bla</p>", message: "test html without close tag with dropElements list ['div']"},
  {config_input: {}, value: "<custom-element>test</custom-element>bla", result: "bla", message: "default behavior for custom elements"},
  {config_input: {allowCustomElements: true}, value: "<custom-element>test</custom-element>bla", result: "<custom-element>test</custom-element>bla", message: "allow custom elements"},
  {config_input: {allowCustomElements: false}, value: "<custom-element>test</custom-element>bla", result: "bla", message: "disallow custom elements"},
  {config_input: {dropElements: ["custom-element"], allowCustomElements: true}, value: "<custom-element>test</custom-element>bla", result: "bla", message: "allow custom elements with drop list contains [\"custom-element\"]"},
  {config_input: {dropElements: ["script"]}, value: "<script>alert('i am a test')<\/script>", result: "", message: "test script with [\"script\"] as dropElements list"},
  {config_input: {dropElements: ["test-element", "i"]}, value: "<div>balabala<i>test</i></div><test-element>t</test-element>", result: "<div>balabala</div>", message: "dropElements list [\"test-element\", \"i\"]}"},
  {config_input: {dropElements: ["I", "DL"]}, value: "<div>balabala<dl>test</dl></div>", result: "<div>balabala</div>", message: "dropElements list [\"I\", \"DL\"]}"},
  {config_input: {dropElements: ["dl", "p"]}, value: "<div>balabala<i>i</i><p>t</p></div>", result: "<div>balabala<i>i</i></div>", message: "dropElements list [\"dl\", \"p\"]}"},
  {config_input: {dropElements: [123, [], "test", "i", "custom-element"]}, value: "<div>balabala<i>test</i></div><test>t</test><custom-element>custom-element</custom-element>", result: "<div>balabala</div>", message: "dropElements list with invalid values"},
  {config_input: {blockElements: [123, [], "test", "i", "custom-element"]}, value: "<div>balabala<i>test</i></div><test>t</test><custom-element>custom-element</custom-element>", result: "<div>balabalatest</div>t", message: "blockElements list with invalid values"},
  {config_input: {allowElements: ["p"]}, value: "<div>test<div>p</div>tt<p>div</p></div>", result: "testptt<p>div</p>", message: "allowElements list [\"p\"]"},
  {config_input: {allowElements: ["p", "test"]}, value: "<div>test<div>p</div>tt<p>div</p><test>test</test></div>", result: "testptt<p>div</p><test>test</test>", message: "allowElements list [\"p\", \"test\"]"},
  {config_input: {dropElements: ["div"], allowElements: ["div"]}, value: "<div>test</div><p>bla", result: "bla", message: "allowElements list has no influence to dropElements"},
  {config_input: {dropAttributes: {"style": ["p"]}}, value: "<p style='color: black'>Click.</p><div style='color: white'>div</div>", result: "<p>Click.</p><div style=\"color: white\">div</div>", message: "dropAttributes list {\"style\": [\"p\"]} with style attribute"},
  {config_input: {dropAttributes: {"*": ["a"]}}, value: "<a id='a' style='color: black'>Click.</a><div style='color: white'>div</div>", result: "<a>Click.</a><div style=\"color: white\">div</div>", message: "dropAttributes list {\"*\": [\"a\"]} with style attribute"},
  {config_input: {dropAttributes: {}}, value: "<p id='test'>Click.</p>", result: "<p id=\"test\">Click.</p>", message: "empty dropAttributes list with id attribute"},
  {config_input: {dropAttributes: {"id": ["*"]}}, value: "<p id='test'>Click.</p>", result: "<p>Click.</p>", message: "dropAttributes list {\"id\": [\"*\"]} with id attribute"},
  {config_input: {dropAttributes: {"ID": ["*"]}}, value: "<p id='test'>Click.</p>", result: "<p>Click.</p>", message: "dropAttributes list {\"ID\": [\"*\"]} with id attribute"},
  {config_input: {dropAttributes: {"data-attribute-with-dashes": ["*"]}}, value: "<p id='p' data-attribute-with-dashes='123'>Click.</p><script>document.getElementById('p').dataset.attributeWithDashes=123;</script>", result: "<p id=\"p\">Click.</p>", message: "dropAttributes list {\"data-attribute-with-dashes\": [\"*\"]} with dom dataset js access"},
  {config_input: {allowAttributes: {"id": ["div"]}}, value: "<p id='p'>P</p><div id='div'>DIV</div>", result: "<p>P</p><div id=\"div\">DIV</div>", message: "allowAttributes list {\"id\": [\"div\"]} with id attribute"},
  {config_input: {allowAttributes: {"id": ["*"]}}, value: "<p id='test' onclick='a= 123'>Click.</p>", result: "<p id=\"test\">Click.</p>", message: "allowAttributes list {\"id\": [\"*\"]} with id attribute and onclick scripts"},
  {config_input: {allowAttributes: {"*": ["a"]}}, value: "<a id='a' style='color: black'>Click.</a><div style='color: white'>div</div>", result: "<a id=\"a\" style=\"color: black\">Click.</a><div>div</div>", message: "allowAttributes list {\"*\": [\"a\"]} with style attribute"},
  {config_input: {dropAttributes: {"style": ["*"]}, allowAttributes: {"style": ["*"]}}, value: "<p style='color: black'>Click.</p>", result: "<p>Click.</p>", message: "allowAttributes list has no influence to dropAttributes"},
];
