"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const Promise = require("bluebird");
const settle_promise_1 = require("settle-promise");
const logger_1 = require("./logger");
const RESOLVED = Promise.resolve();
class TaskManager {
    constructor(opts = {}) {
        this.add = (task) => {
            this.logger.debug('add', { name: task.name });
            const promise = task.promise || RESOLVED.then(task.promiser);
            task = Object.assign({}, task, { promise });
            const start = Date.now();
            promise
                .then(result => {
                this.logger.debug('task completed', {
                    name: task.name,
                    time: Date.now() - start
                });
            })
                .catch(err => {
                this.logger.warn('task failed', {
                    name: task.name,
                    stack: err.stack
                });
            })
                .finally(() => {
                this.tasks.splice(this.tasks.indexOf(task), 1);
            });
            this.tasks.push(task);
            return promise;
        };
        this.awaitAll = () => __awaiter(this, void 0, void 0, function* () {
            if (!this.tasks.length)
                return [];
            this.logger.debug(`waiting for ${this.tasks.length} tasks to complete`);
            return yield Promise.all(this.tasks.map(task => task.promise));
        });
        this.awaitAllSettled = () => __awaiter(this, void 0, void 0, function* () {
            if (!this.tasks.length)
                return [];
            this.logger.debug(`waiting for ${this.tasks.length} tasks to complete or fail`);
            const names = this.tasks.map(task => task.name);
            const results = yield settle_promise_1.settle(this.tasks.map(task => task.promise));
            results.forEach((result, i) => {
                result.task = names[i].name;
            });
            return results;
        });
        this.logger = opts.logger || new logger_1.default('task-manager');
        this.tasks = [];
    }
}
exports.TaskManager = TaskManager;
//# sourceMappingURL=task-manager.js.map