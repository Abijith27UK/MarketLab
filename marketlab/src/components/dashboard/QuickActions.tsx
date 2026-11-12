import React from "react";
import { ArrowLeftRight, LineChart, SlidersHorizontal, Star } from "lucide-react";
import { Button } from "@/components/ui";

export type QuickActionPage = "markets" | "screener" | "watchlists" | "trading";

const ACTIONS: { id: QuickActionPage; label: string; Icon: typeof LineChart }[] = [
  { id: "markets", label: "Markets", Icon: LineChart },
  { id: "screener", label: "Screener", Icon: SlidersHorizontal },
  { id: "watchlists", label: "Watchlists", Icon: Star },
  { id: "trading", label: "Paper trading", Icon: ArrowLeftRight },
];

/** Compact shortcut row. The sidebar already owns primary navigation. */
export const QuickActions: React.FC<{ onNavigate: (page: QuickActionPage) => void }> = ({
  onNavigate,
}) => (
  <nav className="ml-quick-actions" aria-label="Dashboard shortcuts">
    {ACTIONS.map(({ id, label, Icon }) => (
      <Button key={id} variant="secondary" size="sm" onClick={() => onNavigate(id)}>
        <Icon size={15} aria-hidden="true" />
        {label}
      </Button>
    ))}
  </nav>
);

export default QuickActions;
