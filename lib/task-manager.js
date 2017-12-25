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
const lodash_1 = require("lodash");
const settle_promise_1 = require("settle-promise");
const logger_1 = require("./logger");
const Errors = require("./errors");
const RESOLVED = Promise.resolve();
class TaskManager {
    constructor({ logger } = {}) {
        this.add = (task) => {
            this.logger.debug('add', { name: task.name });
            if (task.retryOnFail && !task.promiser) {
                throw new Error('expected "promiser"');
            }
            const promise = task.promise || RESOLVED.then(() => task.promiser());
            task = Object.assign({}, task, { promise });
            this.monitorTask(task);
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
            results.forEach(({ reason }) => {
                if (reason && Errors.isDeveloperError(reason)) {
                    this.logger.warn('developer error', Errors.export(reason));
                }
            });
            return results.map((result, i) => (Object.assign({}, result, { name: names[i] })));
        });
        this.monitorTask = (task) => __awaiter(this, void 0, void 0, function* () {
            const start = Date.now();
            try {
                yield task.promise;
                this.logger.debug('task completed', {
                    name: task.name,
                    time: Date.now() - start
                });
            }
            catch (err) {
                this.logger.warn('task failed', {
                    name: task.name,
                    stack: err.stack
                });
                if (task.retryOnFail) {
                    this.add(lodash_1.omit(task, ['promise']));
                }
            }
            finally {
                this.tasks.splice(this.tasks.indexOf(task), 1);
            }
        });
        this.logger = logger || new logger_1.default('task-manager');
        this.tasks = [];
    }
}
exports.TaskManager = TaskManager;
//# sourceMappingURL=task-manager.js.map