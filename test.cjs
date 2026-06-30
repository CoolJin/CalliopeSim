const Parser = require('tree-sitter');
const Cpp = require('tree-sitter-cpp');
const parser = new Parser();
parser.setLanguage(Cpp);
const tree = parser.parse('string x = "hello"; std::string y = "world"; int arr[2][2] = {{1,2},{3,4}}; int arr2[5]; arr[0][1] = 5;');
console.log(tree.rootNode.toString());
