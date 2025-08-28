import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Model {
  id: string;
  name: string;
  provider: string;
  providerId: string;
  cost?: {
    input?: number;
    output?: number;
  };
  reasoning?: boolean;
  tool_call?: boolean;
  open_weights?: boolean;
}

interface ModelPickerProps {
  selectedModel: { providerId: string; modelId: string } | null;
  onModelSelect: (providerId: string, modelId: string) => void;
  recentModels: Array<{
    providerId: string;
    modelId: string;
    name: string;
    provider: string;
  }>;
}

// Custom hook for debounced search
const useDebounce = (value: string, delay: number) => {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
};

const ModelPicker: React.FC<ModelPickerProps> = ({
  selectedModel,
  onModelSelect,
  recentModels,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState({
    top: 0,
    left: 0,
    width: 0,
  });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Debounce search query to reduce filtering operations
  const debouncedSearchQuery = useDebounce(searchQuery, 150);

  useEffect(() => {
    const fetchModels = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/models');
        if (!response.ok) throw new Error('Failed to fetch models');

        const data = await response.json();
        const modelsArray: Model[] = [];

        // Transform the nested provider/model structure into a flat array
        Object.entries(data).forEach(
          ([providerId, providerData]: [string, any]) => {
            if (providerData.models) {
              Object.entries(providerData.models).forEach(
                ([modelId, modelData]: [string, any]) => {
                  modelsArray.push({
                    id: modelId,
                    name: modelData.name || modelId,
                    provider: providerData.name || providerId,
                    providerId,
                    cost: modelData.cost,
                    reasoning: modelData.reasoning,
                    tool_call: modelData.tool_call,
                    open_weights: modelData.open_weights,
                  });
                }
              );
            }
          }
        );

        setModels(modelsArray);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch models');
      } finally {
        setLoading(false);
      }
    };

    fetchModels();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () =>
        document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Provider priority order (higher number = higher priority)
  const getProviderPriority = useCallback((providerId: string): number => {
    const priorities: Record<string, number> = {
      anthropic: 5,
      openai: 4,
      xai: 3,
      google: 2,
      opencode: 1,
    };
    return priorities[providerId.toLowerCase()] || 0;
  }, []);

  // Memoize filtered models to prevent recalculation on every render
  const filteredModels = useMemo(() => {
    let results = models;

    if (debouncedSearchQuery) {
      const query = debouncedSearchQuery.toLowerCase();
      results = models.filter(
        model =>
          model.name.toLowerCase().includes(query) ||
          model.provider.toLowerCase().includes(query) ||
          model.id.toLowerCase().includes(query)
      );
    }

    // Sort by provider priority, then alphabetically by name
    return results.sort((a, b) => {
      const priorityDiff =
        getProviderPriority(b.providerId) - getProviderPriority(a.providerId);
      if (priorityDiff !== 0) return priorityDiff;

      // Same priority level - sort alphabetically by model name
      return a.name.localeCompare(b.name);
    });
  }, [models, debouncedSearchQuery, getProviderPriority]);

  // Limit rendered models to improve performance
  const displayModels = useMemo(() => {
    const maxResults = 50; // Only show first 50 results
    return filteredModels.slice(0, maxResults);
  }, [filteredModels]);

  const handleModelSelect = useCallback(
    (providerId: string, modelId: string) => {
      onModelSelect(providerId, modelId);
      setIsOpen(false);
      setSearchQuery('');
    },
    [onModelSelect]
  );

  const handleButtonClick = useCallback(() => {
    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setDropdownPosition({
        top: rect.bottom + window.scrollY + 4,
        left: rect.left + window.scrollX,
        width: rect.width,
      });
    }
    setIsOpen(!isOpen);
  }, [isOpen]);

  const getCurrentModelName = useCallback(() => {
    if (!selectedModel) return 'Claude Sonnet 4'; // Default model

    const model = models.find(
      m =>
        m.providerId === selectedModel.providerId &&
        m.id === selectedModel.modelId
    );

    const recent = recentModels.find(
      m =>
        m.providerId === selectedModel.providerId &&
        m.modelId === selectedModel.modelId
    );

    return (
      model?.name || recent?.name || selectedModel.modelId || 'Claude Sonnet 4'
    );
  }, [selectedModel, models, recentModels]);

  // Memoize ModelItem to prevent unnecessary re-renders
  const ModelItem = React.memo<{ model: Model; isRecent?: boolean }>(
    ({ model, isRecent }) => (
      <div
        className="flex items-center justify-between p-3 hover:bg-muted/50 cursor-pointer border-b border-border/50"
        onClick={() => handleModelSelect(model.providerId, model.id)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-sm truncate text-foreground">
              {model.name}
            </span>
            {isRecent && (
              <Badge variant="outline" className="text-xs">
                Recent
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{model.provider}</span>
            {model.tool_call && (
              <Badge variant="secondary" className="text-xs px-1">
                Tools
              </Badge>
            )}
            {model.reasoning && (
              <Badge variant="secondary" className="text-xs px-1">
                Reasoning
              </Badge>
            )}
            {model.open_weights && (
              <Badge variant="outline" className="text-xs px-1">
                Open
              </Badge>
            )}
          </div>
        </div>
        {model.cost && (
          <div className="text-xs text-muted-foreground font-mono ml-2">
            ${model.cost.input?.toFixed(2) || '?'}/$
            {model.cost.output?.toFixed(2) || '?'}
          </div>
        )}
      </div>
    )
  );

  const dropdown = (
    <div
      className="fixed w-96 bg-card text-foreground border border-border rounded-md shadow-lg"
      style={{
        top: `${dropdownPosition.top}px`,
        left: `${dropdownPosition.left}px`,
        minWidth: `${Math.max(dropdownPosition.width, 384)}px`,
        zIndex: 9999,
      }}
      ref={dropdownRef}
    >
      <div className="p-3 border-b border-border">
        <input
          type="text"
          placeholder="Search models..."
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          className="w-full px-3 py-2 text-sm bg-background text-foreground border border-border rounded focus:outline-none focus:ring-2 focus:ring-primary/20"
          autoFocus
        />
        {debouncedSearchQuery && filteredModels.length > 50 && (
          <div className="text-xs text-muted-foreground mt-1">
            Showing first 50 of {filteredModels.length} results
          </div>
        )}
      </div>

      <ScrollArea className="max-h-96">
        {loading && (
          <div className="p-4 text-center text-muted-foreground">
            Loading models...
          </div>
        )}

        {error && (
          <div className="p-4 text-center text-destructive text-sm">
            {error}
          </div>
        )}

        {!loading && !error && (
          <>
            {/* Recent Models Section */}
            {recentModels.length > 0 && !debouncedSearchQuery && (
              <div>
                <div className="px-3 py-2 text-xs font-semibold text-muted-foreground bg-muted/30">
                  Recent Models
                </div>
                {recentModels.map(recent => {
                  const fullModel = models.find(
                    m =>
                      m.providerId === recent.providerId &&
                      m.id === recent.modelId
                  );
                  return (
                    <ModelItem
                      key={`${recent.providerId}-${recent.modelId}`}
                      model={
                        fullModel || {
                          id: recent.modelId,
                          name: recent.name,
                          provider: recent.provider,
                          providerId: recent.providerId,
                        }
                      }
                      isRecent
                    />
                  );
                })}
                <div className="px-3 py-2 text-xs font-semibold text-muted-foreground bg-muted/30">
                  All Models
                </div>
              </div>
            )}

            {/* All Models */}
            {displayModels.length === 0 && debouncedSearchQuery && (
              <div className="p-4 text-center text-muted-foreground text-sm">
                No models found for "{debouncedSearchQuery}"
              </div>
            )}

            {displayModels.map(model => (
              <ModelItem
                key={`${model.providerId}-${model.id}`}
                model={model}
              />
            ))}
          </>
        )}
      </ScrollArea>
    </div>
  );

  return (
    <>
      <Button
        ref={buttonRef}
        variant="outline"
        size="sm"
        onClick={handleButtonClick}
        className="gap-2 min-w-[200px] justify-start"
      >
        <span className="text-primary">🤖</span>
        <span className="truncate">{getCurrentModelName()}</span>
        <span className="ml-auto">▼</span>
      </Button>

      {isOpen && createPortal(dropdown, document.body)}
    </>
  );
};

export default ModelPicker;
