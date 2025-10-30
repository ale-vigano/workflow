"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWorkbenchLibraryWorkflow = runWorkbenchLibraryWorkflow;
const uppercase_1 = require("../steps/uppercase");
const WORKFLOW_KEY = 'library:workbench';
async function runWorkbenchLibraryWorkflow(input) {
    'use workflow';
    if (typeof uppercase_1.uppercaseStep !== 'function') {
        throw new Error('uppercaseStep is not a function. Steps export failed.');
    }
    const result = await (0, uppercase_1.uppercaseStep)(input.value);
    return {
        ok: true,
        workflow: WORKFLOW_KEY,
        echo: result.input,
        upper: result.upper,
        processedAt: result.processedAt,
    };
}
//# sourceMappingURL=workbench-library.js.map