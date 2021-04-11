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

// optionally pass a base path
const basePath = path.resolve(__dirname, '../../hscloud/tsconfig.json');
console.log(basePath);

const program = TJS.programFromConfig(basePath);

const generator = TJS.buildGenerator(program, settings);

// all symbols
const symbols = generator.getUserSymbols();

// Get symbols for different types from generator.
const dto = generator.getSchemaForSymbol("IDeviceDTO");

function getDefinition(refs) {
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
