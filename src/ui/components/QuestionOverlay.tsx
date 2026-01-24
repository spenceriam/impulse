import { createSignal, Show, For, createMemo } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { Colors } from "../design";
import type { Question } from "../../tools/question";

/**
 * QuestionOverlay Props
 */
interface QuestionOverlayProps {
  questions: Question[];
  onSubmit: (answers: string[][]) => void;
  onCancel: () => void;
}

/**
 * QuestionOverlay Component
 * 
 * Displays structured questions from the AI with selectable options.
 * Supports single-select and multi-select questions.
 * 
 * NEW DESIGN - 2-column grid layout with numbered hotkeys:
 * 
 * ┌─ CLARIFYING: Development Environment ────────────────────────────┐
 * │                                                                  │
 * │ What is your current Mac model and year?                         │
 * │                                                                  │
 * │  ┌──────────────────────────┐  ┌──────────────────────────────┐  │
 * │  │ [1] MacBook Pro (Intel)  │  │ [2] MacBook Pro (Apple Si)   │  │
 * │  │     2016-2021            │  │     M1/M2/M3                 │  │
 * │  └──────────────────────────┘  └──────────────────────────────┘  │
 * │                                                                  │
 * │  ┌──────────────────────────┐  ┌──────────────────────────────┐  │
 * │  │ [3] MacBook Air (Intel)  │  │ [4] MacBook Air (Apple Si)   │  │
 * │  │     2018-2020            │  │     M1/M2/M3                 │  │
 * │  └──────────────────────────┘  └──────────────────────────────┘  │
 * │                                                                  │
 * │  [0] Other...  (type custom answer)                              │
 * │                                                                  │
 * ├──────────────────────────────────────────────────────────────────┤
 * │ [1/3]  1-9: Select  Enter: Confirm  Esc: Cancel                  │
 * └──────────────────────────────────────────────────────────────────┘
 */
export function QuestionOverlay(props: QuestionOverlayProps) {
  // Current question index
  const [questionIndex, setQuestionIndex] = createSignal(0);
  
  // Currently hovered option index (-1 = none)
  const [hoveredIndex, setHoveredIndex] = createSignal(-1);
  
  // Selected options per question: questionIndex -> Set of selected option indices
  const [selections, setSelections] = createSignal<Map<number, Set<number>>>(new Map());
  
  // Custom "Other" input per question
  const [otherInputs, setOtherInputs] = createSignal<Map<number, string>>(new Map());
  
  // Whether "Other" is being edited
  const [editingOther, setEditingOther] = createSignal(false);
  
  const currentQuestion = () => props.questions[questionIndex()];
  
  // Options with "Other" appended (assigned index 0)
  const optionsWithOther = createMemo(() => {
    const q = currentQuestion();
    if (!q) return [];
    // Regular options get indices 1-9, Other gets index 0
    return [...q.options, { label: "Other...", description: "Type custom answer" }];
  });
  
  // Get display number for an option (1-9 for regular, 0 for Other)
  const getOptionNumber = (index: number) => {
    const opts = optionsWithOther();
    // Last option (Other) gets 0, rest get 1-9
    if (index === opts.length - 1) return 0;
    return index + 1;
  };
  
  // Find option index from keyboard number
  const getIndexFromNumber = (num: number): number => {
    const opts = optionsWithOther();
    if (num === 0) return opts.length - 1; // 0 = Other (last item)
    if (num > 0 && num <= opts.length - 1) return num - 1;
    return -1;
  };
  
  const isOtherSelected = () => {
    const q = currentQuestion();
    if (!q) return false;
    const qSel = selections().get(questionIndex());
    const otherIdx = q.options.length; // "Other" is always last
    return qSel?.has(otherIdx) ?? false;
  };

  // Toggle selection for an option
  const toggleSelection = (optIdx: number) => {
    const q = currentQuestion();
    if (!q) return;
    
    const qIdx = questionIndex();
    const newSelections = new Map(selections());
    const qSel = new Set(newSelections.get(qIdx) || []);
    
    if (q.multiple) {
      // Multi-select: toggle
      if (qSel.has(optIdx)) {
        qSel.delete(optIdx);
      } else {
        qSel.add(optIdx);
      }
    } else {
      // Single-select: replace
      qSel.clear();
      qSel.add(optIdx);
    }
    
    newSelections.set(qIdx, qSel);
    setSelections(newSelections);
  };
  
  // Select option and advance (for single-select on hotkey)
  const selectAndAdvance = (optIdx: number) => {
    const q = currentQuestion();
    if (!q) return;
    
    toggleSelection(optIdx);
    
    // If "Other" was selected, start editing
    if (optIdx === q.options.length) {
      setEditingOther(true);
      return;
    }
    
    // For single-select, advance to next question or submit
    if (!q.multiple) {
      if (questionIndex() < props.questions.length - 1) {
        setQuestionIndex((i) => i + 1);
        setHoveredIndex(-1);
      } else {
        submitAnswers();
      }
    }
  };

  // Handle keyboard navigation
  useKeyboard((key) => {
    // If editing "Other" input, handle text input
    if (editingOther()) {
      if (key.name === "escape") {
        setEditingOther(false);
        return;
      }
      if (key.name === "return") {
        setEditingOther(false);
        // Advance to next question
        if (questionIndex() < props.questions.length - 1) {
          setQuestionIndex((i) => i + 1);
          setHoveredIndex(-1);
        } else {
          submitAnswers();
        }
        return;
      }
      if (key.name === "backspace") {
        const qIdx = questionIndex();
        const newInputs = new Map(otherInputs());
        const current = newInputs.get(qIdx) || "";
        newInputs.set(qIdx, current.slice(0, -1));
        setOtherInputs(newInputs);
        return;
      }
      // Regular character input
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        const qIdx = questionIndex();
        const newInputs = new Map(otherInputs());
        const current = newInputs.get(qIdx) || "";
        newInputs.set(qIdx, current + key.sequence);
        setOtherInputs(newInputs);
        return;
      }
      return;
    }
    
    // Cancel
    if (key.name === "escape") {
      props.onCancel();
      return;
    }
    
    // Number keys 0-9 for quick selection
    if (key.sequence && /^[0-9]$/.test(key.sequence)) {
      const num = parseInt(key.sequence, 10);
      const idx = getIndexFromNumber(num);
      if (idx !== -1) {
        selectAndAdvance(idx);
      }
      return;
    }
    
    // Arrow keys for navigation in 2-column grid
    const opts = optionsWithOther();
    const cols = 2;
    const currentIdx = hoveredIndex() === -1 ? 0 : hoveredIndex();
    
    if (key.name === "up") {
      const newIdx = currentIdx - cols;
      setHoveredIndex(Math.max(0, newIdx));
      return;
    }
    if (key.name === "down") {
      const newIdx = currentIdx + cols;
      setHoveredIndex(Math.min(opts.length - 1, newIdx));
      return;
    }
    if (key.name === "left") {
      setHoveredIndex(Math.max(0, currentIdx - 1));
      return;
    }
    if (key.name === "right") {
      setHoveredIndex(Math.min(opts.length - 1, currentIdx + 1));
      return;
    }
    
    // Space to toggle selection (for multi-select)
    if (key.name === "space") {
      const idx = hoveredIndex() === -1 ? 0 : hoveredIndex();
      toggleSelection(idx);
      return;
    }
    
    // Enter to select hovered option and proceed
    if (key.name === "return") {
      const idx = hoveredIndex() === -1 ? 0 : hoveredIndex();
      selectAndAdvance(idx);
      return;
    }
    
    // Tab to go to next question (for multi-select)
    if (key.name === "tab" && !key.shift) {
      if (questionIndex() < props.questions.length - 1) {
        setQuestionIndex((i) => i + 1);
        setHoveredIndex(-1);
      } else {
        submitAnswers();
      }
      return;
    }
    
    // Shift+Tab to go to previous question
    if (key.name === "tab" && key.shift) {
      if (questionIndex() > 0) {
        setQuestionIndex((i) => i - 1);
        setHoveredIndex(-1);
      }
      return;
    }
  });

  // Submit all answers
  const submitAnswers = () => {
    const answers: string[][] = props.questions.map((q, qIdx) => {
      const qSel = selections().get(qIdx);
      if (!qSel || qSel.size === 0) return [];
      
      const labels: string[] = [];
      qSel.forEach((optIdx) => {
        if (optIdx < q.options.length) {
          // Regular option
          const opt = q.options[optIdx];
          if (opt) labels.push(opt.label);
        } else {
          // "Other" option - use the custom input
          const otherText = otherInputs().get(qIdx);
          if (otherText) {
            labels.push(otherText);
          } else {
            labels.push("Other");
          }
        }
      });
      
      return labels;
    });
    
    props.onSubmit(answers);
  };

  const q = currentQuestion();
  if (!q) return null;
  
  // Build header title with context
  const headerTitle = () => {
    if (q.context) {
      return `CLARIFYING: ${q.context}`;
    }
    return q.header.toUpperCase();
  };
  
  // Group options into pairs for 2-column layout
  const optionPairs = createMemo(() => {
    const opts = optionsWithOther();
    const pairs: Array<Array<{ opt: typeof opts[0]; index: number }>> = [];
    
    for (let i = 0; i < opts.length; i += 2) {
      const pair: Array<{ opt: typeof opts[0]; index: number }> = [];
      pair.push({ opt: opts[i]!, index: i });
      if (i + 1 < opts.length) {
        pair.push({ opt: opts[i + 1]!, index: i + 1 });
      }
      pairs.push(pair);
    }
    
    return pairs;
  });

  return (
    <box
      position="absolute"
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
      backgroundColor="rgba(0,0,0,0.5)"
    >
      <box
        border
        title={headerTitle()}
        flexDirection="column"
        padding={2}
        width={80}
        maxHeight={28}
        backgroundColor="#1a1a1a"
      >
        {/* Question text */}
        <text fg={Colors.ui.text}>{q.question}</text>
        <box height={1} />
        
        {/* Options in 2-column grid */}
        <For each={optionPairs()}>
          {(pair) => (
            <box flexDirection="row" marginBottom={1}>
              <For each={pair}>
                {({ opt, index }) => {
                  const isHovered = () => hoveredIndex() === index;
                  const isSelected = () => {
                    const qSel = selections().get(questionIndex());
                    return qSel?.has(index) ?? false;
                  };
                  const optNum = getOptionNumber(index);
                  const isOther = index === optionsWithOther().length - 1;
                  
                  // Checkbox/radio indicator
                  const indicator = () => {
                    if (q.multiple) {
                      return isSelected() ? "[x]" : "[ ]";
                    } else {
                      return isSelected() ? "(*)" : "( )";
                    }
                  };
                  
                  return (
                    <box
                      width={36}
                      marginRight={2}
                      flexDirection="column"
                      padding={1}
                      border={isHovered() || isSelected()}
                      borderColor={isSelected() ? Colors.ui.primary : Colors.ui.dim}
                      backgroundColor={isHovered() ? "#252530" : "#1a1a1a"}
                    >
                      <box flexDirection="row">
                        <text fg={isSelected() ? Colors.ui.primary : Colors.ui.dim}>
                          {indicator()}
                        </text>
                        <text fg={Colors.status.info}> [{optNum}] </text>
                        <text fg={isSelected() ? Colors.ui.primary : Colors.ui.text}>
                          {opt.label}
                        </text>
                      </box>
                      <text fg={Colors.ui.dim}>    {opt.description}</text>
                      
                      {/* Show "Other" input field when selected */}
                      <Show when={isOther && isOtherSelected()}>
                        <box flexDirection="row" marginTop={1}>
                          <text fg={Colors.ui.dim}>{">"} </text>
                          <Show
                            when={editingOther()}
                            fallback={
                              <text fg={Colors.ui.text}>
                                {otherInputs().get(questionIndex()) || "(press Enter to type)"}
                              </text>
                            }
                          >
                            <text fg={Colors.ui.primary}>
                              {(otherInputs().get(questionIndex()) || "") + "_"}
                            </text>
                          </Show>
                        </box>
                      </Show>
                    </box>
                  );
                }}
              </For>
            </box>
          )}
        </For>
        
        {/* Footer with navigation hints */}
        <box height={1} />
        <text fg={Colors.ui.dim}>{"─".repeat(74)}</text>
        <box 
          flexDirection="row" 
          justifyContent="space-between"
          paddingTop={1}
        >
          <text fg={Colors.ui.dim}>
            [{questionIndex() + 1}/{props.questions.length}]
          </text>
          <text fg={Colors.ui.dim}>
            0-9: Select
            <Show when={q.multiple}>{" "}Space: Toggle</Show>
            <Show when={props.questions.length > 1}>{" "}Tab: Next</Show>
            {" "}Enter: Confirm  Esc: Cancel
          </text>
        </box>
      </box>
    </box>
  );
}
