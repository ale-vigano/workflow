"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.uppercaseStep = uppercaseStep;
async function uppercaseStep(value) {
    'use step';
    return {
        input: value,
        upper: value.toUpperCase(),
        processedAt: Date.now(),
    };
}
//# sourceMappingURL=uppercase.js.map