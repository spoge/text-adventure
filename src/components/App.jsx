import React, { useEffect, useReducer, useMemo } from "react";
import "../styles/App.css";
import Game from "./Game";
import GameContext from "./GameContext";
import { GameSaveReducer } from "../reducers/GameSaveReducer";
import { GameInstanceReducer } from "../reducers/GameInstanceReducer";
import fetchChapter from "../utils/FetchChapter";

const defaultSaveState = {
  chapterId: "-start-",
  sceneId: "",
  flags: [],
};

const appBasePath = () => new URL(import.meta.env.BASE_URL, window.location.origin).pathname;

const isResetPath = () => {
  const basePath = appBasePath();
  return [
    `${basePath}reset`,
    `${basePath}reset/`,
  ].includes(window.location.pathname);
};

const fetchInitialSaveState = () => {
  if (isResetPath()) {
    localStorage.removeItem("save");
    window.history.replaceState(null, "", appBasePath());
    return defaultSaveState;
  }

  const localSave = JSON.parse(localStorage.getItem("save"));
  return {
    chapterId: localSave?.chapterId ? localSave.chapterId : defaultSaveState.chapterId,
    sceneId: localSave?.sceneId ? localSave.sceneId : defaultSaveState.sceneId,
    flags: localSave?.flags ? [...localSave.flags] : defaultSaveState.flags,
  };
};

const initialInstanceState = {
  actionIndex: 0,
  debugMode: false,
  debugHelp: false,
};

const App = () => {
  const [saveState, saveDispatch] = useReducer(
    GameSaveReducer,
    undefined,
    fetchInitialSaveState
  );

  const [instanceState, instanceDispatch] = useReducer(
    GameInstanceReducer,
    initialInstanceState
  );

  const contextValues = useMemo(() => {
    return { saveState, saveDispatch, instanceState, instanceDispatch };
  }, [saveState, saveDispatch, instanceState, instanceDispatch]);

  // Spawn at starting location when chapterId is "-start-"
  useEffect(() => {
    if (saveState.chapterId !== "-start-") return;
    fetchChapter("-start-").then((value) => {
      saveDispatch({ type: "remove_all_flags", payload: {} });
      saveDispatch({ type: "movement", payload: value });
    });
  }, [saveState.chapterId]);

  return (
    <div className="app">
      <GameContext.Provider value={contextValues}>
        <Game />
      </GameContext.Provider>
    </div>
  );
};

export default App;
