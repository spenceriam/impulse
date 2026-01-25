import { createSignal, Show, For } from "solid-js";
import { useKeyboard } from "@opentui/solid";
import { Colors } from "../design";
import type { Question } from "../../tools/question";

/**
 * QuestionOverlay Props
 */
interface QuestionOverlayProps {
  context?: string;
  questions: Question[];
  onSubmit: (answers: string[][]) => void;
  onCancel: () => void;
}

/**
 * UI State
 */
type UIState = "answering" | "review";

/**
 * QuestionOverlay Component
 * 
 * Tab-based question UI with topics, review screen, and editable answers.
 * 
 * DESIGN:
 * - Topics shown as tabs: [ Project setup ] [ UI stack ] [ CI/CD ]
 * - Tab/Shift+Tab navigates between topics
 * - Up/Down navigates options within topic
 * - "Type your own answer" expands when selected
 * - Review screen shows all answers as editable text boxes
 * - Max 3 topics per batch
 */
export function QuestionOverlay(props: QuestionOverlayProps) {
  // UI state: answering questions or reviewing
  const [uiState, setUIState] = createSignal<UIState>("answering");
  
  // Current topic (tab) index
  const [topicIndex, setTopicIndex] = createSignal(0);
  
  // Currently hovered option index within current topic
  const [hoveredIndex, setHoveredIndex] = createSignal(0);
  
  // Selected option per topic: topicIndex -> selected option index (-1 = custom)
  const [selections, setSelections] = createSignal<Map<number, number>>(new Map());
  
  // Custom answer text per topic
  const [customAnswers, setCustomAnswers] = createSignal<Map<number, string>>(new Map());
  
  // Whether custom input is expanded (for current topic)
  const [customExpanded, setCustomExpanded] = createSignal(false);
  
  // Review screen: which answer field is focused
  const [reviewFocusIndex, setReviewFocusIndex] = createSignal(0);
  
  // Review screen: editable answers (pre-filled from selections)
  const [reviewAnswers, setReviewAnswers] = createSignal<string[]>([]);
  
  const currentQuestion = () => props.questions[topicIndex()];
  const totalTopics = () => props.questions.length;
  
  // Options for current topic (without "Type your own" - that's separate)
  const currentOptions = () => currentQuestion()?.options || [];
  
  // Total items to navigate: options + 1 for "Type your own"
  const totalItems = () => currentOptions().length + 1;
  
  // Check if "Type your own" is the hovered item
  const isCustomHovered = () => hoveredIndex() === currentOptions().length;
  
  // Check if topic has an answer
  const hasAnswer = (tIdx: number) => {
    const sel = selections().get(tIdx);
    const custom = customAnswers().get(tIdx);
    return sel !== undefined || (custom !== undefined && custom.length > 0);
  };
  
  // Get answer text for a topic
  const getAnswerText = (tIdx: number): string => {
    const sel = selections().get(tIdx);
    const custom = customAnswers().get(tIdx);
    
    if (custom && custom.length > 0) {
      return custom;
    }
    
    if (sel !== undefined && sel >= 0) {
      const q = props.questions[tIdx];
      const opt = q?.options[sel];
      return opt?.label || "";
    }
    
    return "";
  };
  
  // Select an option (clears custom answer)
  const selectOption = (optIdx: number) => {
    const tIdx = topicIndex();
    const newSelections = new Map(selections());
    newSelections.set(tIdx, optIdx);
    setSelections(newSelections);
    
    // Clear custom answer when selecting an option
    const newCustom = new Map(customAnswers());
    newCustom.delete(tIdx);
    setCustomAnswers(newCustom);
    setCustomExpanded(false);
  };
  
  // Set custom answer (clears option selection)
  const setCustomAnswer = (text: string) => {
    const tIdx = topicIndex();
    const newCustom = new Map(customAnswers());
    newCustom.set(tIdx, text);
    setCustomAnswers(newCustom);
    
    // Clear option selection when typing custom
    const newSelections = new Map(selections());
    newSelections.delete(tIdx);
    setSelections(newSelections);
  };
  
  // Navigate to next topic or go to review
  const nextTopic = () => {
    if (topicIndex() < totalTopics() - 1) {
      setTopicIndex(i => i + 1);
      setHoveredIndex(0);
      setCustomExpanded(false);
    } else {
      // All topics answered, go to review
      initializeReview();
      setUIState("review");
    }
  };
  
  // Navigate to previous topic
  const prevTopic = () => {
    if (topicIndex() > 0) {
      setTopicIndex(i => i - 1);
      setHoveredIndex(0);
      setCustomExpanded(false);
    }
  };
  
  // Initialize review answers from selections
  const initializeReview = () => {
    const answers = props.questions.map((_, idx) => getAnswerText(idx));
    setReviewAnswers(answers);
    setReviewFocusIndex(0);
  };
  
  // Go back from review to edit a specific topic (used by number keys in review)
  const editTopic = (tIdx: number) => {
    setTopicIndex(tIdx);
    setHoveredIndex(0);
    setCustomExpanded(false);
    setUIState("answering");
  };
  
  // Submit all answers
  const submitAnswers = () => {
    const answers: string[][] = reviewAnswers().map(answer => 
      answer.trim() ? [answer.trim()] : []
    );
    props.onSubmit(answers);
  };
  
  // Handle keyboard in answering state
  const handleAnsweringKeys = (key: any) => {
    // If custom input is expanded, handle text input
    if (customExpanded()) {
      if (key.name === "escape") {
        setCustomExpanded(false);
        return;
      }
      if (key.name === "return") {
        // Confirm custom answer and move to next topic
        nextTopic();
        return;
      }
      if (key.name === "backspace") {
        const tIdx = topicIndex();
        const current = customAnswers().get(tIdx) || "";
        setCustomAnswer(current.slice(0, -1));
        return;
      }
      // Regular character input
      if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
        const tIdx = topicIndex();
        const current = customAnswers().get(tIdx) || "";
        setCustomAnswer(current + key.sequence);
        return;
      }
      return;
    }
    
    // Tab/Shift+Tab: navigate topics
    if (key.name === "tab") {
      if (key.shift) {
        prevTopic();
      } else {
        nextTopic();
      }
      return;
    }
    
    // Up/Down: navigate options
    if (key.name === "up") {
      setHoveredIndex(i => Math.max(0, i - 1));
      return;
    }
    if (key.name === "down") {
      setHoveredIndex(i => Math.min(totalItems() - 1, i + 1));
      return;
    }
    
    // Number keys 1-9 for quick select, 0 for custom
    if (key.sequence && /^[0-9]$/.test(key.sequence)) {
      const num = parseInt(key.sequence, 10);
      if (num === 0) {
        // Select custom input
        setHoveredIndex(currentOptions().length);
        setCustomExpanded(true);
      } else if (num <= currentOptions().length) {
        // Select option and advance
        selectOption(num - 1);
        nextTopic();
      }
      return;
    }
    
    // Enter: select hovered item
    if (key.name === "return") {
      if (isCustomHovered()) {
        setCustomExpanded(true);
      } else {
        selectOption(hoveredIndex());
        nextTopic();
      }
      return;
    }
    
    // Escape: cancel
    if (key.name === "escape") {
      props.onCancel();
      return;
    }
  };
  
  // Handle keyboard in review state
  const handleReviewKeys = (key: any) => {
    const focused = reviewFocusIndex();
    const answers = reviewAnswers();
    
    // Tab/Shift+Tab: navigate answer fields
    if (key.name === "tab") {
      if (key.shift) {
        setReviewFocusIndex(i => Math.max(0, i - 1));
      } else {
        setReviewFocusIndex(i => Math.min(totalTopics() - 1, i + 1));
      }
      return;
    }
    
    // Up/Down: also navigate fields
    if (key.name === "up") {
      setReviewFocusIndex(i => Math.max(0, i - 1));
      return;
    }
    if (key.name === "down") {
      setReviewFocusIndex(i => Math.min(totalTopics() - 1, i + 1));
      return;
    }
    
    // Number keys: focus that field
    if (key.sequence && /^[1-9]$/.test(key.sequence)) {
      const num = parseInt(key.sequence, 10);
      if (num <= totalTopics()) {
        setReviewFocusIndex(num - 1);
      }
      return;
    }
    
    // 'e' key: go back to edit the focused topic's original question
    if (key.name === "e" || key.sequence === "e") {
      editTopic(reviewFocusIndex());
      return;
    }
    
    // Backspace: delete last char in focused field
    if (key.name === "backspace") {
      const newAnswers = [...answers];
      newAnswers[focused] = (newAnswers[focused] || "").slice(0, -1);
      setReviewAnswers(newAnswers);
      return;
    }
    
    // Regular character input
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
      const newAnswers = [...answers];
      newAnswers[focused] = (newAnswers[focused] || "") + key.sequence;
      setReviewAnswers(newAnswers);
      return;
    }
    
    // Enter: submit all
    if (key.name === "return") {
      submitAnswers();
      return;
    }
    
    // Escape: go back to answering (edit mode)
    if (key.name === "escape") {
      // Go back to first topic that needs attention
      setTopicIndex(0);
      setUIState("answering");
      return;
    }
  };
  
  // Keyboard handler
  useKeyboard((key) => {
    if (uiState() === "answering") {
      handleAnsweringKeys(key);
    } else {
      handleReviewKeys(key);
    }
  });
  
  // Render tabs
  const renderTabs = () => {
    return (
      <box flexDirection="row" marginBottom={1}>
        <For each={props.questions}>
          {(q, idx) => {
            const isActive = () => topicIndex() === idx();
            const isComplete = () => hasAnswer(idx());
            
            // Tab style: [ Topic ✓ ] or [ Topic ]
            const tabText = () => {
              const check = isComplete() ? " ✓" : "";
              return `[ ${q.topic}${check} ]`;
            };
            
            return (
              <text 
                fg={isActive() ? Colors.ui.primary : (isComplete() ? Colors.status.success : Colors.ui.dim)}
              >
                {tabText()}{" "}
              </text>
            );
          }}
        </For>
      </box>
    );
  };
  
  // Render options for current topic
  const renderOptions = () => {
    const q = currentQuestion();
    if (!q) return null;
    
    const selectedIdx = selections().get(topicIndex());
    const customText = customAnswers().get(topicIndex()) || "";
    const hasCustom = customText.length > 0;
    
    return (
      <>
        <For each={q.options}>
          {(opt, idx) => {
            const isHovered = () => hoveredIndex() === idx();
            const isSelected = () => selectedIdx === idx() && !hasCustom;
            const optNum = idx() + 1;
            
            const checkbox = () => isSelected() ? "[x]" : "[ ]";
            const rowBg = () => isHovered() ? "#252530" : "#1a1a1a";
            const textColor = () => isSelected() ? Colors.ui.primary : Colors.ui.text;
            
            return (
              <box backgroundColor={rowBg()} paddingLeft={1} height={1}>
                <box flexDirection="row">
                  <text fg={isSelected() ? Colors.ui.primary : Colors.ui.dim}>
                    {checkbox()}
                  </text>
                  <text fg={Colors.status.info}> [{optNum}] </text>
                  <text fg={textColor()}>{opt.label}</text>
                  <text fg={Colors.ui.dim}> ── {opt.description}</text>
                </box>
              </box>
            );
          }}
        </For>
        
        {/* "Type your own answer" option */}
        <box 
          backgroundColor={isCustomHovered() ? "#252530" : "#1a1a1a"} 
          paddingLeft={1}
          flexDirection="column"
        >
          <box flexDirection="row" height={1}>
            <text fg={hasCustom ? Colors.ui.primary : Colors.ui.dim}>
              {hasCustom ? "[x]" : "[ ]"}
            </text>
            <text fg={Colors.status.info}> [0] </text>
            <text fg={hasCustom ? Colors.ui.primary : Colors.ui.text}>
              Type your own answer
            </text>
          </box>
          
          {/* Expanded custom input */}
          <Show when={customExpanded()}>
            <box flexDirection="row" paddingLeft={6} height={1}>
              <text fg={Colors.ui.dim}>{">"} </text>
              <text fg={Colors.ui.primary}>
                {customText + "_"}
              </text>
            </box>
          </Show>
        </box>
      </>
    );
  };
  
  // Render review screen
  const renderReview = () => {
    const answers = reviewAnswers();
    
    return (
      <box flexDirection="column">
        <text fg={Colors.ui.text}>Please confirm your answers:</text>
        <box height={1} />
        
        <scrollbox height={Math.min(totalTopics() * 4 + 2, 14)}>
          <For each={props.questions}>
            {(q, idx) => {
              const isFocused = () => reviewFocusIndex() === idx();
              const answer = () => answers[idx()] || "";
              
              return (
                <box flexDirection="column" marginBottom={1}>
                  <text fg={Colors.ui.dim}>
                    [{idx() + 1}] {q.topic}: {q.question}
                  </text>
                  <box 
                    border 
                    borderColor={isFocused() ? Colors.ui.primary : Colors.ui.dim}
                    backgroundColor={isFocused() ? "#252530" : "#1a1a1a"}
                    paddingLeft={1}
                    height={1}
                  >
                    <text fg={isFocused() ? Colors.ui.primary : Colors.ui.text}>
                      {isFocused() ? answer() + "_" : answer() || "(no answer)"}
                    </text>
                  </box>
                </box>
              );
            }}
          </For>
        </scrollbox>
      </box>
    );
  };
  
  // Footer hints
  const footerHints = () => {
    if (uiState() === "review") {
      return "Tab: Next field  ↑↓: Navigate  Enter: Submit all  Esc: Back";
    }
    
    if (customExpanded()) {
      return "Type answer  Enter: Confirm  Esc: Cancel";
    }
    
    const parts: string[] = [];
    if (topicIndex() > 0) parts.push("Shift+Tab: Prev");
    parts.push("Tab: Next");
    parts.push("↑↓: Navigate");
    parts.push("Enter: Select");
    parts.push("Esc: Cancel");
    
    return parts.join("  ");
  };
  
  // Header title
  const headerTitle = () => {
    if (uiState() === "review") {
      return "REVIEW ANSWERS";
    }
    return props.context ? `CLARIFYING: ${props.context}` : "CLARIFYING";
  };

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
        padding={1}
        paddingLeft={2}
        paddingRight={2}
        width={76}
        backgroundColor="#1a1a1a"
      >
        <Show when={uiState() === "answering"}>
          {/* Tabs */}
          {renderTabs()}
          
          {/* Question text */}
          <text fg={Colors.ui.text}>{currentQuestion()?.question}</text>
          <box height={1} />
          
          {/* Options */}
          {renderOptions()}
        </Show>
        
        <Show when={uiState() === "review"}>
          {renderReview()}
        </Show>
        
        {/* Footer */}
        <box height={1} />
        <text fg={Colors.ui.dim}>{footerHints()}</text>
      </box>
    </box>
  );
}
