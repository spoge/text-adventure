import { useCallback, useContext, useEffect, useRef, useState } from "react";
import { useKeyPress } from "./useKeyPress";
import GameContext from "../components/GameContext";

import { isVisible } from "../utils/CheckFlag";
import dispatchTrigger from "../utils/DispatchTrigger";
import fetchChapter from "../utils/FetchChapter";

const useGameLogic = () => {
  const { saveState, saveDispatch, instanceState, instanceDispatch } =
    useContext(GameContext);

  const gameRef = useRef(null);
  const chapterCache = useRef({});
  const chapterRequests = useRef({});
  const flags = saveState.flags;

  const [chapter, setChapter] = useState({});
  const [loadedChapterId, setLoadedChapterId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const scene =
    loadedChapterId === saveState.chapterId
      ? chapter?.scenes?.find((l) => l.id === saveState.sceneId)
      : undefined;
  const availableActions = scene?.actions?.filter((a) => isVisible(flags, a));
  const actionIndex = instanceState.actionIndex;

  const fetchCachedChapter = useCallback((chapterId) => {
    if (chapterCache.current[chapterId] !== undefined) {
      return Promise.resolve(chapterCache.current[chapterId]);
    }

    if (chapterRequests.current[chapterId] !== undefined) {
      return chapterRequests.current[chapterId];
    }

    const request = fetchChapter(chapterId)
      .then((value) => {
        chapterCache.current[chapterId] = value;
        delete chapterRequests.current[chapterId];
        return value;
      })
      .catch((error) => {
        delete chapterRequests.current[chapterId];
        throw error;
      });

    chapterRequests.current[chapterId] = request;
    return request;
  }, []);

  // When chapter refreshes
  useEffect(() => {
    if (chapterCache.current[saveState.chapterId] !== undefined) {
      setChapter(chapterCache.current[saveState.chapterId]);
      setLoadedChapterId(saveState.chapterId);
      setIsLoading(false);
      return;
    }

    let isCurrentRequest = true;

    setIsLoading(true);
    fetchCachedChapter(saveState.chapterId)
      .then((value) => {
        if (!isCurrentRequest) return;
        setChapter(value);
        setLoadedChapterId(saveState.chapterId);
        setIsLoading(false);
      })
      .catch(() => {
        if (!isCurrentRequest) return;
        setIsLoading(false);
      });

    return () => {
      isCurrentRequest = false;
    };
  }, [saveState.chapterId, fetchCachedChapter, instanceDispatch]);

  // When scene refreshes
  useEffect(() => {
    instanceDispatch({ type: "set_selected_index", payload: 0 });
    gameRef.current?.focus();
  }, [saveState.chapterId, saveState.sceneId, instanceDispatch]);

  // When save state refreshes
  useEffect(() => {
    localStorage.setItem("save", JSON.stringify(saveState));
  }, [saveState]);

  // Preload chapters reachable from visible actions in the current scene.
  useEffect(() => {
    if (availableActions === undefined) return;

    const chapterIds = availableActions
      .flatMap((action) => action.triggers || [])
      .filter(
        (trigger) =>
          trigger.type === "movement" &&
          trigger.chapterId !== undefined &&
          trigger.chapterId !== saveState.chapterId
      )
      .map((trigger) => trigger.chapterId);

    [...new Set(chapterIds)].forEach((chapterId) => {
      fetchCachedChapter(chapterId).catch(() => {});
    });
  }, [availableActions, fetchCachedChapter, saveState.chapterId]);

  const actionClick = (actionIndex) => {
    availableActions !== undefined &&
      availableActions[actionIndex]?.triggers?.forEach((trigger) =>
        dispatchTrigger(saveDispatch, trigger)
      );
  };

  const setActionIndex = (newIndex) => {
    if (newIndex < 0 || newIndex >= availableActions?.length) return;
    instanceDispatch({
      type: "set_selected_index",
      payload: newIndex,
    });
  };

  // actions nav
  useKeyPress(() => actionClick(actionIndex), ["Enter", " "]);
  useKeyPress(() => setActionIndex(actionIndex - 1), ["ArrowUp", "Up", "w"]);
  useKeyPress(
    () => setActionIndex(actionIndex + 1),
    ["ArrowDown", "Down", "s"]
  );

  return {
    gameRef,
    scene,
    flags,
    availableActions,
    actionClick,
    isLoading: isLoading || scene === undefined,
  };
};

export default useGameLogic;
