import React, { useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { defaultCondition } from "@/lib/backtestTypes";
import {
  CONDITION_LABEL,
  CONDITION_TYPES,
  type ConditionType,
  type RuleSet,
  type StrategyCondition,
} from "@backtest/types";

interface RuleEditorProps {
  title: string;
  description: string;
  ruleSet: RuleSet;
  onChange: (next: RuleSet) => void;
  allowEmpty: boolean;
  emptyHint?: string;
}

const CONDITION_OPTIONS = CONDITION_TYPES.map((type) => ({
  value: type,
  label: CONDITION_LABEL[type],
}));

function isMaCondition(type: ConditionType): boolean {
  return (
    type === "PRICE_ABOVE_MA" ||
    type === "PRICE_BELOW_MA" ||
    type === "PRICE_CROSS_ABOVE_MA" ||
    type === "PRICE_CROSS_BELOW_MA" ||
    type === "FAST_MA_ABOVE_SLOW_MA" ||
    type === "FAST_MA_BELOW_SLOW_MA"
  );
}

function isFastSlowCondition(type: ConditionType): boolean {
  return type === "FAST_MA_ABOVE_SLOW_MA" || type === "FAST_MA_BELOW_SLOW_MA";
}

function isRsiCondition(type: ConditionType): boolean {
  return type === "RSI_ABOVE" || type === "RSI_BELOW";
}

function isMacdCondition(type: ConditionType): boolean {
  return type === "MACD_CROSS_ABOVE" || type === "MACD_CROSS_BELOW";
}

const numberValue = (value: string): number | null => {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Structured rule editor. Condition types come from a fixed list — a user can
 * only combine rules the engine implements, and never supplies code.
 */
export const RuleEditor: React.FC<RuleEditorProps> = ({
  title,
  description,
  ruleSet,
  onChange,
  allowEmpty,
  emptyHint,
}) => {
  const [pendingType, setPendingType] = useState<ConditionType>("PRICE_CROSS_ABOVE_MA");

  const updateCondition = (index: number, patch: Partial<StrategyCondition>) => {
    onChange({
      ...ruleSet,
      conditions: ruleSet.conditions.map((condition, i) =>
        i === index ? { ...condition, ...patch } : condition
      ),
    });
  };

  const changeType = (index: number, type: ConditionType) => {
    const fresh = defaultCondition(type);
    onChange({
      ...ruleSet,
      conditions: ruleSet.conditions.map((condition, i) => (i === index ? fresh : condition)),
    });
  };

  const removeCondition = (index: number) => {
    onChange({
      ...ruleSet,
      conditions: ruleSet.conditions.filter((_, i) => i !== index),
    });
  };

  const addCondition = () => {
    onChange({ ...ruleSet, conditions: [...ruleSet.conditions, defaultCondition(pendingType)] });
  };

  return (
    <fieldset className="ml-rule-editor">
      <legend className="ml-section-title">{title}</legend>
      <p className="ml-section-sub mb-2">{description}</p>

      <div className="ml-rule-combinator">
        <span className="text-xs text-gray-400">Match</span>
        <div className="w-28">
          <Select
            value={ruleSet.combinator}
            onSelect={(value) =>
              onChange({ ...ruleSet, combinator: value as RuleSet["combinator"] })
            }
            options={[
              { value: "AND", label: "All (AND)" },
              { value: "OR", label: "Any (OR)" },
            ]}
            disabled={ruleSet.conditions.length < 2}
          />
        </div>
      </div>

      {ruleSet.conditions.length === 0 ? (
        <p className="ml-rule-empty">{allowEmpty ? emptyHint ?? "No conditions." : "Add at least one condition."}</p>
      ) : (
        <ul className="ml-rule-list">
          {ruleSet.conditions.map((condition, index) => {
            const type = condition.type as ConditionType;
            return (
              <li key={index} className="ml-rule-row" data-testid="rule-row">
                <div className="ml-rule-row-head">
                  <span className="ml-rule-index">{index + 1}</span>
                  <div className="flex-1">
                    <Select
                      value={type}
                      onSelect={(value) => changeType(index, value as ConditionType)}
                      options={CONDITION_OPTIONS}
                      label={`Condition ${index + 1}`}
                    />
                  </div>
                  <button
                    type="button"
                    className="ml-row-action is-danger"
                    onClick={() => removeCondition(index)}
                    aria-label={`Remove condition ${index + 1}`}
                  >
                    Remove
                  </button>
                </div>

                <div className="ml-rule-row-fields">
                  {isMaCondition(type) && (
                    <div className="w-28">
                      <Select
                        label="Average"
                        value={condition.maKind ?? "SMA"}
                        onSelect={(value) =>
                          updateCondition(index, { maKind: value as "SMA" | "EMA" })
                        }
                        options={[
                          { value: "SMA", label: "SMA" },
                          { value: "EMA", label: "EMA" },
                        ]}
                      />
                    </div>
                  )}

                  {isFastSlowCondition(type) || isMacdCondition(type) ? (
                    <div className="flex gap-2">
                      <div className="w-24">
                        <Input
                          label="Fast"
                          type="number"
                          value={String(condition.fast ?? "")}
                          onChange={(value) => updateCondition(index, { fast: numberValue(value) })}
                        />
                      </div>
                      <div className="w-24">
                        <Input
                          label="Slow"
                          type="number"
                          value={String(condition.slow ?? "")}
                          onChange={(value) => updateCondition(index, { slow: numberValue(value) })}
                        />
                      </div>
                      {isMacdCondition(type) && (
                        <div className="w-24">
                          <Input
                            label="Signal"
                            type="number"
                            value={String(condition.signal ?? "")}
                            onChange={(value) =>
                              updateCondition(index, { signal: numberValue(value) })
                            }
                          />
                        </div>
                      )}
                    </div>
                  ) : (
                    isMaCondition(type) || isRsiCondition(type) ? (
                      <div className="w-24">
                        <Input
                          label="Period"
                          type="number"
                          value={String(condition.period ?? "")}
                          onChange={(value) => updateCondition(index, { period: numberValue(value) })}
                        />
                      </div>
                    ) : null
                  )}

                  {isRsiCondition(type) && (
                    <div className="w-28">
                      <Input
                        label="Threshold"
                        type="number"
                        value={String(condition.threshold ?? "")}
                        onChange={(value) =>
                          updateCondition(index, { threshold: numberValue(value) })
                        }
                      />
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="ml-rule-add">
        <div className="flex-1">
          <Select
            label="Add a condition"
            value={pendingType}
            onSelect={(value) => setPendingType(value as ConditionType)}
            options={CONDITION_OPTIONS}
          />
        </div>
        <Button variant="secondary" size="sm" onClick={addCondition} disabled={ruleSet.conditions.length >= 6}>
          Add
        </Button>
      </div>
    </fieldset>
  );
};

export default RuleEditor;
