/*
 * AI Web Worker 入口。
 * 先导入唯一规则内核，再导入引擎，保证禁手/成五判断与主线程一致。
 * 版本号需与 index.html 中的 ?v= 一起更新。
 */
importScripts('rules.js?v=4.2');
importScripts('ai-core.js?v=4.2');