/**
 * Kept as the public entry point so existing pages and tests keep importing
 * `@/components/market/StockCard`. The implementation now lives in
 * StockQuoteCard, which composes the shared quote primitives.
 */
export { default } from "./StockQuoteCard";
export { StockQuoteCard as StockCard } from "./StockQuoteCard";
export type { StockQuoteCardProps as StockCardProps } from "./StockQuoteCard";
