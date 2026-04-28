"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.minutesSince = minutesSince;
exports.secondsSince = secondsSince;
exports.sleep = sleep;
function minutesSince(date) {
    return (Date.now() - date.getTime()) / 60000;
}
function secondsSince(date) {
    return (Date.now() - date.getTime()) / 1000;
}
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}
