import { createSignal, onMount, For, Show } from "solid-js";
import { useAppKeyboard } from "../context/keyboard";
import { Colors } from "../design";
import { fetchChangelog, parseChangelog, type ChangelogEntry } from "../../util/changelog";

/**
 * Changelog Overlay Component
 * Fetches and displays the changelog from GitHub repository
 * 
 * Shows 20 entries initially, with "Load more" to show 20 more at a time.
 * Triggered by /changelog command.
 */

interface ChangelogOverlayProps {
  onClose: () => void;
}

// How many entries to show initially and per "load more" click
const ENTRIES_PER_PAGE = 20;

// Get color for release type badge
function getTypeColor(type: ChangelogEntry["type"]): string {
  switch (type) {
    case "major":
      return Colors.status.error;
    case "minor":
      return Colors.mode.AGENT;
    case "patch":
      return Colors.ui.dim;
    default:
      return Colors.ui.dim;
  }
}

// Get display label for type
function getTypeLabel(type: ChangelogEntry["type"]): string {
  switch (type) {
    case "major":
      return "MAJOR";
    case "minor":
      return "MINOR";
    case "patch":
      return "PATCH";
    default:
      return "";
  }
}

export function ChangelogOverlay(props: ChangelogOverlayProps) {
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [allEntries, setAllEntries] = createSignal<ChangelogEntry[]>([]);
  const [visibleCount, setVisibleCount] = createSignal(ENTRIES_PER_PAGE);
  
  // Computed: entries currently visible
  const visibleEntries = () => allEntries().slice(0, visibleCount());
  
  // Computed: are there more entries to load?
  const hasMore = () => visibleCount() < allEntries().length;
  
  // Computed: how many more entries are available
  const remainingCount = () => allEntries().length - visibleCount();
  
  // Load more entries
  const loadMore = () => {
    setVisibleCount(prev => Math.min(prev + ENTRIES_PER_PAGE, allEntries().length));
  };
  
  // Close on Escape or Enter (but not if we're on "Load more")
  useAppKeyboard((key) => {
    if (key.name === "escape") {
      props.onClose();
    }
  });
  
  // Fetch changelog on mount
  onMount(async () => {
    try {
      const markdown = await fetchChangelog();
      const parsed = parseChangelog(markdown);
      setAllEntries(parsed);
      setLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to fetch changelog");
      setLoading(false);
    }
  });
  
  return (
    <box
      position="absolute"
      width="100%"
      height="100%"
      justifyContent="center"
      alignItems="center"
    >
      {/* Semi-transparent backdrop */}
      <box
        position="absolute"
        width="100%"
        height="100%"
        backgroundColor="#000000"
      />
      
      {/* Overlay content */}
      <box
        border
        title={`Changelog (${visibleCount()}/${allEntries().length} releases)`}
        borderColor={Colors.ui.dim}
        backgroundColor="#1a1a1a"
        width={80}
        height={35}
        flexDirection="column"
      >
        {/* Loading state */}
        <Show when={loading()}>
          <box
            flexGrow={1}
            justifyContent="center"
            alignItems="center"
          >
            <text fg={Colors.ui.dim}>Fetching changelog from repository...</text>
          </box>
        </Show>
        
        {/* Error state */}
        <Show when={error()}>
          <box
            flexGrow={1}
            flexDirection="column"
            padding={2}
          >
            <text fg={Colors.status.error}>Failed to fetch changelog:</text>
            <text fg={Colors.status.error}>{error()}</text>
            <box height={1} />
            <text fg={Colors.ui.dim}>View directly at:</text>
            <text fg={Colors.mode.AGENT}>https://github.com/spenceriam/impulse/blob/main/CHANGELOG.md</text>
          </box>
        </Show>
        
        {/* Content */}
        <Show when={!loading() && !error()}>
          <scrollbox
            flexGrow={1}
            focused
            style={{
              scrollbarOptions: {
                trackOptions: {
                  foregroundColor: Colors.mode.AGENT,
                  backgroundColor: Colors.ui.dim,
                },
              },
              viewportOptions: {
                paddingLeft: 2,
                paddingRight: 2,
                paddingTop: 1,
                paddingBottom: 1,
              },
            }}
          >
            <box flexDirection="column">
              <For each={visibleEntries()}>
                {(entry, index) => (
                  <box flexDirection="column">
                    {/* Version header with type badge */}
                    <box flexDirection="row">
                      <text fg={Colors.ui.text}>
                        <strong>v{entry.version}</strong>
                      </text>
                      <text fg={Colors.ui.dim}> - {entry.date} </text>
                      <text fg={getTypeColor(entry.type)}>
                        [{getTypeLabel(entry.type)}]
                      </text>
                    </box>
                    
                    {/* Title if present */}
                    <Show when={entry.title}>
                      <text fg={Colors.mode.AGENT}>{entry.title}</text>
                    </Show>
                    
                    {/* Changes list */}
                    <For each={entry.changes}>
                      {(change) => (
                        <box flexDirection="row" paddingLeft={2}>
                          <text fg={Colors.ui.dim}>- </text>
                          <text fg={Colors.ui.text}>{change}</text>
                        </box>
                      )}
                    </For>
                    
                    {/* Separator between entries */}
                    <Show when={index() < visibleEntries().length - 1 || hasMore()}>
                      <box height={1} />
                      <text fg={Colors.ui.dim}>{"─".repeat(74)}</text>
                      <box height={1} />
                    </Show>
                  </box>
                )}
              </For>
              
              {/* Load more button */}
              <Show when={hasMore()}>
                <box 
                  flexDirection="row" 
                  justifyContent="center"
                  paddingTop={1}
                  paddingBottom={1}
                >
                  <box
                    onMouseDown={loadMore}
                    paddingLeft={2}
                    paddingRight={2}
                  >
                    <text fg={Colors.mode.AGENT}>
                      [ Load {Math.min(ENTRIES_PER_PAGE, remainingCount())} more ({remainingCount()} remaining) ]
                    </text>
                  </box>
                </box>
              </Show>
              
              {/* End of list indicator */}
              <Show when={!hasMore() && allEntries().length > 0}>
                <box height={1} />
                <box flexDirection="row" justifyContent="center">
                  <text fg={Colors.ui.dim}>— End of changelog —</text>
                </box>
              </Show>
            </box>
          </scrollbox>
        </Show>
        
        {/* Fixed footer */}
        <box flexShrink={0} paddingLeft={2} paddingBottom={1}>
          <text fg={Colors.ui.dim}>
            Esc: close | ↑↓: scroll{hasMore() ? " | Click 'Load more' for older releases" : ""}
          </text>
        </box>
      </box>
    </box>
  );
}
