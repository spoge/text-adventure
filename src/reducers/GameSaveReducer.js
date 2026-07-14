const GameSaveReducer = (state, action) => {
  switch (action.type) {
    case "movement":
      return {
        ...state,
        sceneId: action.payload.sceneId,
        chapterId:
          action.payload.chapterId === undefined
            ? state.chapterId
            : action.payload.chapterId,
      };
    case "remove_flag":
      return {
        ...state,
        flags: [...state.flags.filter((f) => f !== action.payload)],
      };
    case "add_flag":
      return { ...state, flags: [...state.flags, action.payload] };
    case "remove_all_flags":
      return { ...state, flags: [] };
    case "remove_all_flags_except": {
      if (!Array.isArray(action.payload) || action.payload.length === 0) {
        return state;
      }
      return {
        ...state,
        flags: state.flags.filter((flag) => action.payload.includes(flag)),
      };
    }
    default:
      return state;
  }
};

export { GameSaveReducer };
