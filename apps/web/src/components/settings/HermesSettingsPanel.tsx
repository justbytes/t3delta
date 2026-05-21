import {
  ArrowLeftRightIcon,
  ChevronDownIcon,
  GripVerticalIcon,
  PlusIcon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ServerProviderSkill } from "@t3delta/contracts";
import type { HermesSkillCategorySettings } from "@t3delta/contracts/settings";

import { HermesIcon } from "../chat/ProviderModelPicker";
import { useSettings, useUpdateSettings } from "../../hooks/useSettings";
import {
  GENERAL_PROVIDER_SKILL_CATEGORY_ID,
  deleteProviderSkillCategory,
  normalizeProviderSkillCategory,
  resolveProviderSkillCategories,
  resolveProviderSkillCategoryId,
  setProviderSkillCategoryAssignment,
  upsertProviderSkillCategory,
} from "../../providerSkillCategories";
import { formatProviderSkillDisplayName } from "../../providerSkillPresentation";
import { useServerProviders } from "../../rpc/serverState";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { SettingsPageContainer, SettingsSection } from "./settingsLayout";

type DragState = {
  skillName: string;
} | null;

const emptySkillCategorySettings: HermesSkillCategorySettings = {
  categories: [],
  assignments: {},
};

const emptyProviderSkills: readonly ServerProviderSkill[] = [];

function nextCategoryId(label: string) {
  return normalizeProviderSkillCategory(label.replace(/[^a-zA-Z0-9]+/g, "-"));
}

function skillDescription(skill: ServerProviderSkill) {
  return skill.shortDescription ?? skill.description ?? skill.name;
}

export function HermesSettingsPanel() {
  const settings = useSettings((value) => value.hermesSkillCategories);
  const { updateSettings } = useUpdateSettings();
  const serverProviders = useServerProviders();
  const hermesProvider = serverProviders.find((provider) => provider.provider === "hermes");
  const skills = hermesProvider?.skills ?? emptyProviderSkills;
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [dragState, setDragState] = useState<DragState>(null);
  const [openCategoryIds, setOpenCategoryIds] = useState<ReadonlySet<string>>(() => new Set());
  const [skillPendingMove, setSkillPendingMove] = useState<ServerProviderSkill | null>(null);

  const categorySettings = settings ?? emptySkillCategorySettings;
  const categories = useMemo(
    () => resolveProviderSkillCategories(skills, categorySettings),
    [categorySettings, skills],
  );
  const enabledSkills = useMemo(() => skills.filter((skill) => skill.enabled), [skills]);

  const persist = (nextSettings: HermesSkillCategorySettings) => {
    updateSettings({ hermesSkillCategories: nextSettings });
  };

  const handleRenameCategory = (categoryId: string, label: string) => {
    persist(upsertProviderSkillCategory(categorySettings, categoryId, label));
  };

  const handleCreateCategory = () => {
    const label = newCategoryLabel.trim();
    if (!label) return;
    persist(upsertProviderSkillCategory(categorySettings, nextCategoryId(label), label));
    setNewCategoryLabel("");
  };

  const handleMoveSkill = (skillName: string, categoryId: string) => {
    persist(setProviderSkillCategoryAssignment(categorySettings, skillName, categoryId));
  };

  const handleDeleteCategory = (categoryId: string) => {
    persist(deleteProviderSkillCategory(categorySettings, categoryId, enabledSkills));
    setOpenCategoryIds((existing) => {
      const next = new Set(existing);
      next.delete(categoryId);
      next.add(GENERAL_PROVIDER_SKILL_CATEGORY_ID);
      return next;
    });
  };

  const handleReset = () => {
    persist(emptySkillCategorySettings);
    setOpenCategoryIds(new Set());
  };

  const toggleCategory = (categoryId: string, open: boolean) => {
    setOpenCategoryIds((existing) => {
      const next = new Set(existing);
      if (open) next.add(categoryId);
      else next.delete(categoryId);
      return next;
    });
  };

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Hermes setup"
        icon={<HermesIcon className="size-4" />}
        headerAction={
          <Button size="sm" variant="outline" onClick={handleReset}>
            <RotateCcwIcon className="size-3.5" />
            Reset defaults
          </Button>
        }
      >
        <div className="border-t-0 px-3 py-3 sm:px-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-foreground">
                Skill categories
              </h3>
              <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground/80">
                Customize how Hermes skills are grouped in the $ skill menu. Categories are closed
                by default; open one to inspect skills, drag them between groups, or use the move
                button.
              </p>
            </div>
            <div className="flex min-w-0 gap-2 sm:w-72">
              <Input
                className="h-8"
                value={newCategoryLabel}
                placeholder="New category"
                onChange={(event) => setNewCategoryLabel(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleCreateCategory();
                }}
              />
              <Button size="sm" type="button" onClick={handleCreateCategory}>
                <PlusIcon className="size-3.5" />
                Add
              </Button>
            </div>
          </div>

          {categories.length === 0 ? (
            <div className="mt-3 rounded-lg border border-dashed border-border/70 p-4 text-center text-sm text-muted-foreground">
              Hermes skills have not been reported by the provider yet.
            </div>
          ) : (
            <div className="mt-3 grid gap-2">
              {categories.map((category) => {
                const categorySkills = enabledSkills.filter(
                  (skill) =>
                    resolveProviderSkillCategoryId(skill, categorySettings) === category.id,
                );
                const isGeneral = category.id === GENERAL_PROVIDER_SKILL_CATEGORY_ID;
                const isOpen = openCategoryIds.has(category.id);
                const isDropTarget = Boolean(dragState);
                return (
                  <Collapsible
                    key={category.id}
                    open={isOpen}
                    onOpenChange={(open) => toggleCategory(category.id, open)}
                  >
                    <section
                      className={cn(
                        "rounded-lg border border-border/70 bg-background/50",
                        isDropTarget && "border-dashed",
                      )}
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={(event) => {
                        event.preventDefault();
                        if (!dragState) return;
                        handleMoveSkill(dragState.skillName, category.id);
                        setDragState(null);
                        toggleCategory(category.id, true);
                      }}
                    >
                      <div className="flex min-w-0 items-center gap-2 px-2 py-1.5">
                        <CollapsibleTrigger
                          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-accent/60"
                          aria-label={`${isOpen ? "Close" : "Open"} ${category.label}`}
                        >
                          <ChevronDownIcon
                            className={cn(
                              "size-4 shrink-0 text-muted-foreground transition-transform",
                              !isOpen && "-rotate-90",
                            )}
                          />
                          <span className="truncate text-sm font-medium">{category.label}</span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            {category.skillCount.toLocaleString()}
                          </span>
                        </CollapsibleTrigger>
                        {!isGeneral ? (
                          <Input
                            className="hidden h-8 w-44 text-xs sm:block"
                            value={category.label}
                            aria-label={`Rename ${category.label} category`}
                            onClick={(event) => event.stopPropagation()}
                            onChange={(event) =>
                              handleRenameCategory(category.id, event.target.value)
                            }
                          />
                        ) : null}
                        {!isGeneral ? (
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Delete ${category.label} category`}
                            onClick={() => handleDeleteCategory(category.id)}
                          >
                            <Trash2Icon className="size-4" />
                          </Button>
                        ) : null}
                      </div>
                      <CollapsibleContent>
                        <div className="grid gap-1.5 border-t border-border/60 p-2">
                          {categorySkills.length === 0 ? (
                            <div className="rounded-md border border-dashed border-border/60 px-3 py-2 text-xs text-muted-foreground">
                              Drop skills here to add them to this category.
                            </div>
                          ) : (
                            categorySkills.map((skill) => (
                              <div
                                key={skill.name}
                                draggable
                                className="flex cursor-grab items-center justify-between gap-2 rounded-md border border-border/60 bg-card px-2 py-1.5 text-sm active:cursor-grabbing"
                                onDragStart={() => setDragState({ skillName: skill.name })}
                                onDragEnd={() => setDragState(null)}
                              >
                                <div className="flex min-w-0 items-center gap-2">
                                  <GripVerticalIcon className="size-4 shrink-0 text-muted-foreground/70" />
                                  <div className="min-w-0">
                                    <div className="truncate font-medium">
                                      {formatProviderSkillDisplayName(skill)}
                                    </div>
                                    <div className="truncate text-xs text-muted-foreground">
                                      {skillDescription(skill)}
                                    </div>
                                  </div>
                                </div>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  aria-label={`Move ${skill.name}`}
                                  onClick={() => setSkillPendingMove(skill)}
                                >
                                  <ArrowLeftRightIcon className="size-4" />
                                </Button>
                              </div>
                            ))
                          )}
                        </div>
                      </CollapsibleContent>
                    </section>
                  </Collapsible>
                );
              })}
            </div>
          )}
        </div>
      </SettingsSection>

      <Dialog
        open={Boolean(skillPendingMove)}
        onOpenChange={(open) => !open && setSkillPendingMove(null)}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>Move skill</DialogTitle>
            <DialogDescription>
              {skillPendingMove
                ? `Choose where to move ${formatProviderSkillDisplayName(skillPendingMove)}.`
                : "Choose a category for this skill."}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="grid gap-2">
            {categories.map((category) => (
              <Button
                key={category.id}
                variant="outline"
                className="justify-between"
                onClick={() => {
                  if (!skillPendingMove) return;
                  handleMoveSkill(skillPendingMove.name, category.id);
                  setOpenCategoryIds((existing) => new Set(existing).add(category.id));
                  setSkillPendingMove(null);
                }}
              >
                <span>{category.label}</span>
                <span className="text-xs text-muted-foreground">
                  {category.skillCount.toLocaleString()}{" "}
                  {category.skillCount === 1 ? "skill" : "skills"}
                </span>
              </Button>
            ))}
          </DialogPanel>
        </DialogPopup>
      </Dialog>
    </SettingsPageContainer>
  );
}
