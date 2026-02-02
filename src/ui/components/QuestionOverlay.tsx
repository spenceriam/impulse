import { createSignal, Show, For } from "solid-js";
import { useAppKeyboard } from "../context/keyboard";
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
  
  // Navigate to next topic (wraps around)
  const nextTopic = () => {
    setTopicIndex(i => (i + 1) % totalTopics());
    setHoveredIndex(0);
    setCustomExpanded(false);
  };
  
  // Check if all topics have answers
  const allAnswered = () => {
    for (let i = 0; i < totalTopics(); i++) {
      if (!hasAnswer(i)) return false;
    }
    return true;
  };
  
  // Go to review screen (only when all answered)
  const goToReview = () => {
    if (allAnswered()) {
      initializeReview();
      setUIState("review");
    }
  };
  
  // Navigate to previous topic (wraps around)
  const prevTopic = () => {
    setTopicIndex(i => (i - 1 + totalTopics()) % totalTopics());
    setHoveredIndex(0);
    setCustomExpanded(false);
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
        // Confirm custom answer - check if all answered, go to review or next topic
        setCustomExpanded(false);
        // Use setTimeout to let state update before checking
        setTimeout(() => {
          if (allAnswered()) {
            goToReview();
          } else {
            nextTopic();
          }
        }, 0);
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
    
    // Number keys 1-9 for quick select (no auto-advance)
    if (key.sequence && /^[1-9]$/.test(key.sequence)) {
      const num = parseInt(key.sequence, 10);
      if (num <= currentOptions().length) {
        selectOption(num - 1);
      }
      return;
    }
    
    // Enter: select hovered item, or go to review if all answered
    if (key.name === "return") {
      if (isCustomHovered()) {
        setCustomExpanded(true);
        return;
      }
      
      // Select the option
      selectOption(hoveredIndex());
      
      // After selecting, check if all topics are answered
      // If all answered, go to review. Otherwise advance to next unanswered topic.
      setTimeout(() => {
        if (allAnswered()) {
          goToReview();
        } else {
          // Find next unanswered topic and go to it
          for (let i = 0; i < totalTopics(); i++) {
            const nextIdx = (topicIndex() + 1 + i) % totalTopics();
            if (!hasAnswer(nextIdx)) {
              setTopicIndex(nextIdx);
              setHoveredIndex(0);
              return;
            }
          }
        }
      }, 10);
      return;
    }
    
    // Escape: cancel overlay
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
    
    // Up/Down: navigate between fields
    if (key.name === "up") {
      setReviewFocusIndex(i => Math.max(0, i - 1));
      return;
    }
    if (key.name === "down") {
      setReviewFocusIndex(i => Math.min(totalTopics() - 1, i + 1));
      return;
    }
    
    // PageUp/PageDown: scroll within focused field (if content overflows)
    // This allows viewing long answers without leaving the field
    if (key.name === "pageup" || key.name === "pagedown") {
      // Scrolling is handled by the scrollbox component automatically
      // when focused - no additional handling needed here
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
    
    // Enter: submit all (check BEFORE character input handler)
    if (key.name === "return") {
      submitAnswers();
      return;
    }
    
    // Escape: go back to answering mode (not cancel entirely)
    if (key.name === "escape") {
      setUIState("answering");
      return;
    }
    
    // Backspace: delete last char in focused field
    if (key.name === "backspace") {
      const newAnswers = [...answers];
      newAnswers[focused] = (newAnswers[focused] || "").slice(0, -1);
      setReviewAnswers(newAnswers);
      return;
    }
    
    // Regular character input (exclude control characters)
    if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta && key.sequence.charCodeAt(0) >= 32) {
      const newAnswers = [...answers];
      newAnswers[focused] = (newAnswers[focused] || "") + key.sequence;
      setReviewAnswers(newAnswers);
      return;
    }
  };
  
  // Keyboard handler
  useAppKeyboard((key) => {
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
              const topic = q?.topic || `Q${idx() + 1}`;
              const check = isComplete() ? " ✓" : "";
              return `[ ${topic}${check} ]`;
            };
            
            return (
              <text 
                fg={isActive() ? Colors.ui.primary : (isComplete() ? Colors.status.success : Colors.ui.dim)}
              >
                {tabText() + " "}
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
        <For each={q.options || []}>
          {(opt, idx) => {
            const isHovered = () => hoveredIndex() === idx();
            const isSelected = () => selectedIdx === idx() && !hasCustom;
            const optNum = idx() + 1;
            
            const checkbox = () => isSelected() ? "[x]" : "[ ]";
            const rowBg = () => isHovered() ? "#252530" : "#1a1a1a";
            const textColor = () => isSelected() ? Colors.ui.primary : Colors.ui.text;
            const label = opt?.label || `Option ${optNum}`;
            const description = opt?.description || "";
            
            return (
              <box backgroundColor={rowBg()} paddingLeft={1} height={1}>
                <box flexDirection="row">
                  <text fg={isSelected() ? Colors.ui.primary : Colors.ui.dim}>
                    {checkbox()}
                  </text>
                  <text fg={Colors.status.info}>{` [${optNum}] `}</text>
                  <text fg={textColor()}>{label}</text>
                  <text fg={Colors.ui.dim}>{` ── ${description}`}</text>
                </box>
              </box>
            );
          }}
        </For>
        
        {/* "Type your own answer" option - no number key, user navigates with arrows */}
        <box 
          backgroundColor={isCustomHovered() ? "#252530" : "#1a1a1a"} 
          paddingLeft={1}
          flexDirection="column"
        >
          <box flexDirection="row" height={1}>
            <text fg={hasCustom ? Colors.ui.primary : Colors.ui.dim}>
              {hasCustom ? "[x]" : "[ ]"}
            </text>
            <text>     </text>
            <text fg={hasCustom ? Colors.ui.primary : Colors.ui.text}>
              Type your own answer
            </text>
          </box>
          
          {/* Expanded custom input - scrollable text area */}
          <Show when={customExpanded()}>
            <box 
              flexDirection="row" 
              paddingLeft={6} 
              marginTop={1}
              border
              borderColor={Colors.ui.primary}
              backgroundColor="#252530"
              width={74}
            >
              <box width={2} flexShrink={0}>
                <text fg={Colors.ui.dim}>{">"} </text>
              </box>
              <scrollbox 
                height={3} 
                flexGrow={1}
                stickyScroll
                stickyStart="bottom"
              >
                <box width={68} flexDirection="row">
                  <text fg={Colors.ui.text}>{customText || ""}</text>
                  <text fg={Colors.ui.dim}>_</text>
                </box>
              </scrollbox>
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
        
        {/* Scrollable container for all questions - enough height for 3+ questions */}
        <scrollbox height={20} stickyScroll>
          <box flexDirection="column">
            <For each={props.questions}>
              {(q, idx) => {
                const isFocused = () => reviewFocusIndex() === idx();
                const answer = () => answers[idx()] || "";
                const topic = q?.topic || `Q${idx() + 1}`;
                const question = q?.question || "";
                
                // Calculate height based on answer length (min 1 line, scales with content)
                const answerLines = () => Math.max(1, Math.ceil((answer().length || 12) / 76));
                
                return (
                  <box flexDirection="column" marginBottom={1}>
                    <text fg={Colors.ui.dim}>
                      {`[${idx() + 1}] ${topic}: ${question}`}
                    </text>
                    <box 
                      border 
                      borderColor={isFocused() ? Colors.ui.primary : Colors.ui.dim}
                      backgroundColor={isFocused() ? "#252530" : "#1a1a1a"}
                      paddingLeft={1}
                      width={82}
                      height={answerLines() + 2}
                    >
                      <box width={78} flexDirection="row">
                        <text fg={Colors.ui.text}>
                          {answer() || "(no answer)"}
                        </text>
                        <Show when={isFocused()}>
                          <text fg={Colors.ui.dim}>_</text>
                        </Show>
                      </box>
                    </box>
                  </box>
                );
              }}
            </For>
          </box>
        </scrollbox>
      </box>
    );
  };
  
  // Footer hints
  const footerHints = () => {
    if (uiState() === "review") {
      return "Tab/↑↓: Navigate  Scroll: View content  Enter: Submit  Esc: Back to edit";
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
    // Strip any stray quotes from context (AI sometimes includes them)
    const cleanContext = props.context?.replace(/^["']|["']$/g, "").trim();
    return cleanContext ? `CLARIFYING: ${cleanContext}` : "CLARIFYING";
  };

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
        title={headerTitle()}
        flexDirection="column"
        padding={1}
        width={90}
        backgroundColor="#1a1a1a"
      >
        <Show when={uiState() === "answering" && currentQuestion()}>
          {/* Tabs */}
          {renderTabs()}
          
          {/* Question text */}
          <text fg={Colors.ui.text}>{currentQuestion()?.question || ""}</text>
          <box height={1} />
          
          {/* Options - scrollable to handle many options */}
          <scrollbox height={16} stickyScroll>
            <box flexDirection="column">
              {renderOptions()}
            </box>
          </scrollbox>
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
