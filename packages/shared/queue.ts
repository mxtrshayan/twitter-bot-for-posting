import { Queue } from "bullmq";
import IORedis from "ioredis";
import { config } from "./config";
export const connection = () =>
  new IORedis(config().REDIS_URL, { maxRetriesPerRequest: null });
let queue: Queue | undefined;
export const postingQueue = () =>
  (queue ||= new Queue("browser-jobs", {
    connection: connection(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: 1000,
    },
  }));

let browserQueue: Queue | undefined;
export const profileQueue = () =>
  (browserQueue ||= new Queue("browser-profiles", {
    connection: connection(),
    defaultJobOptions: {
      attempts: 1,
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  }));
