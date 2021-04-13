const path = require('path');
const TJS = require("typescript-json-schema");

// optionally pass argument to schema generator
const settings = {
    required: true,
    ignoreErrors: true,
};

// optionally pass ts compiler options
const compilerOptions = {
    strictNullChecks: true,
};

function getDefinition(tsconfigPath, refs) {
    const program = TJS.programFromConfig(tsconfigPath);
    const generator = TJS.buildGenerator(program, settings);
    // all symbols
    const symbols = generator.getUserSymbols();
    const definitions = {};
    for (let i = 0; i < refs.length; i += 1) {
        const schema = generator.getSchemaForSymbol(refs[i]);
        definitions[refs[i]] = schema;
    }
    return definitions;
}

module.exports = {
    getDefinition: getDefinition,
};
