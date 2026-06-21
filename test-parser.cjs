const Parser = require('tree-sitter');
const Cpp = require('tree-sitter-cpp');

const parser = new Parser();
parser.setLanguage(Cpp);

const code = `#define _GNU_SOURCE
#include "MicroBit.h"
#include "NEPODefs.h"
#include <list>
#include <array>
#include <stdlib.h>
MicroBit _uBit;

int main()
{
    _uBit.init();
    
    // Simulate some basic logic
    while (true) {
        if (_uBit.buttonA.isPressed()) {
            _uBit.display.print("A");
            _uBit.rgb.setColour(MicroBitColor(255, 0, 0, 255));
        } else if (_uBit.buttonB.isPressed()) {
            _uBit.display.print("B");
            _uBit.rgb.setColour(MicroBitColor(0, 255, 0, 255));
        } else {
            _uBit.display.clear();
            _uBit.rgb.off();
        }
        _uBit.sleep(100);
    }
    
    release_fiber();
}`;

const tree = parser.parse(code);
console.log(tree.rootNode.toString());
