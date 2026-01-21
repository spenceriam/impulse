import { createSignal, Show, For } from "solid-js";
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
 * Layout:
 * ┌─ HEADER ─────────────────────────────────────────────────┐
 * │                                                          │
 * │ Question text here?                                      │
 * │                                                          │
 * │ ● Option 1 label (Recommended)                           │
 * │   Description of option 1                                │
 * │                                                          │
 * │ ○ Option 2 label                                         │
 * │   Description of option 2                                │
 * │                                                          │
 * │ ○ Other...                                               │
 * │   Provide custom text input                              │
 * │                                                          │
 * ├──────────────────────────────────────────────────────────┤
 * │ [1/3]  Tab: Next  Enter: Submit  Esc: Cancel             │
 * └──────────────────────────────────────────────────────────┘
 */
export function QuestionOverlay(props: QuestionOverlayProps) {
  // Current question index
  const [questionIndex, setQuestionIndex] = createSignal(0);
  
  // Currently focused option index for current question
  const [optionIndex, setOptionIndex] = createSignal(0);
  
  // Selected options per question: questionIndex -> Set of selected option indices
  // For single-select, only one can be selected; for multi-select, multiple
  const [selections, setSelections] = createSignal<Map<number, Set<number>>>(new Map());
  
  // Custom "Other" input per question
  const [otherInputs, setOtherInputs] = createSignal<Map<number, string>>(new Map());
  
  // Whether "Other" is being edited
  const [editingOther, setEditingOther] = createSignal(false);
  
  const currentQuestion = () => props.questions[questionIndex()];
  
  // Options with "Other" appended
  const optionsWithOther = () => {
    const q = currentQuestion();
    if (!q) return [];
    const opts = [...q.options];
    // Add "Other" option at the end
    opts.push({ label: "Other...", description: "Provide custom text input" });
    return opts;
  };
  
  const isOtherSelected = () => {
    const q = currentQuestion();
    if (!q) return false;
    const qSel = selections().get(questionIndex());
    const otherIdx = q.options.length; // "Other" is always last
    return qSel?.has(otherIdx) ?? false;
  };
  
  const isOtherFocused = () => {
    const q = currentQuestion();
    if (!q) return false;
    return optionIndex() === q.options.length;
  };

  // Toggle selection for current option
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
    
    // Navigate options with up/down
    if (key.name === "up") {
      setOptionIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.name === "down") {
      const opts = optionsWithOther();
      setOptionIndex((i) => Math.min(opts.length - 1, i + 1));
      return;
    }
    
    // Space to toggle selection (for multi-select)
    if (key.name === "space") {
      const q = currentQuestion();
      if (q?.multiple) {
        toggleSelection(optionIndex());
      } else {
        // For single-select, space also selects
        toggleSelection(optionIndex());
      }
      return;
    }
    
    // Enter to select and proceed
    if (key.name === "return") {
      const q = currentQuestion();
      if (!q) return;
      
      // If "Other" is focused and selected, start editing
      if (isOtherFocused()) {
        toggleSelection(optionIndex());
        setEditingOther(true);
        return;
      }
      
      // Select the current option
      toggleSelection(optionIndex());
      
      // Move to next question or submit
      if (questionIndex() < props.questions.length - 1) {
        setQuestionIndex((i) => i + 1);
        setOptionIndex(0);
      } else {
        submitAnswers();
      }
      return;
    }
    
    // Tab to go to next question
    if (key.name === "tab" && !key.shift) {
      if (questionIndex() < props.questions.length - 1) {
        setQuestionIndex((i) => i + 1);
        setOptionIndex(0);
      }
      return;
    }
    
    // Shift+Tab to go to previous question
    if (key.name === "tab" && key.shift) {
      if (questionIndex() > 0) {
        setQuestionIndex((i) => i - 1);
        setOptionIndex(0);
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

  return (
    <box
      position="absolute"
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      <box
        border
        title={q.header.toUpperCase()}
        flexDirection="column"
        padding={2}
        width={70}
        maxHeight={24}
        backgroundColor="#1a1a1a"
      >
        {/* Question text */}
        <text fg={Colors.ui.text}>{q.question}</text>
        <box height={1} />
        
        {/* Options list */}
        <For each={optionsWithOther()}>
          {(opt, i) => {
            const isFocused = () => i() === optionIndex();
            const isSelected = () => {
              const qSel = selections().get(questionIndex());
              return qSel?.has(i()) ?? false;
            };
            
            // Use different indicators for single vs multi-select
            const indicator = () => {
              if (q.multiple) {
                return isSelected() ? "[x]" : "[ ]";
              } else {
                return isSelected() ? "(*)" : "( )";
              }
            };
            
            return (
              <box flexDirection="column" marginBottom={1}>
                <Show
                  when={isFocused()}
                  fallback={
                    <box flexDirection="row">
                      <text fg={isSelected() ? Colors.ui.primary : Colors.ui.dim}>
                        {indicator()}
                      </text>
                      <text fg={Colors.ui.text}> {opt.label}</text>
                    </box>
                  }
                >
                  <box flexDirection="row" backgroundColor={Colors.ui.primary}>
                    <text fg="#000000">{indicator()}</text>
                    <text fg="#000000"> {opt.label}</text>
                  </box>
                </Show>
                <text fg={Colors.ui.dim}>   {opt.description}</text>
                
                {/* Show "Other" input field when editing */}
                <Show when={i() === q.options.length && isOtherSelected()}>
                  <box flexDirection="row" marginTop={1} marginLeft={3}>
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
        
        {/* Footer with navigation hints */}
        <box height={1} />
        <box flexDirection="row" justifyContent="space-between">
          <text fg={Colors.ui.dim}>
            [{questionIndex() + 1}/{props.questions.length}]
          </text>
          <text fg={Colors.ui.dim}>
            <Show when={props.questions.length > 1}>
              {"Tab: Next  "}
            </Show>
            {"Enter: Select  Esc: Cancel"}
          </text>
        </box>
      </box>
    </box>
  );
}
