/** Vitest + fetch JSON typing for server integration tests. */
interface Response {
  json(): Promise<any>;
}
