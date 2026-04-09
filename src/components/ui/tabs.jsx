import React, { useState } from "react";
import { cn } from "../../lib/utils";

export function Tabs({ defaultValue, className, tabs = [], onValueChange }) {
  const [active, setActive] = useState(defaultValue || tabs[0]?.value);
  const setValue = (value) => {
    setActive(value);
    if (onValueChange) onValueChange(value);
  };

  return (
    <div className={cn("w-full", className)}>
      <div className="inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setValue(tab.value)}
            className={cn(
              "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all",
              active === tab.value && "bg-background text-foreground shadow-sm"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="mt-4">{tabs.find((tab) => tab.value === active)?.content || null}</div>
    </div>
  );
}
