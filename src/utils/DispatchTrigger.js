const dispatchTrigger = (dispatch, trigger) => {
  if (trigger === undefined || trigger.type === undefined) {
    return;
  }

  switch (trigger.type) {
    case "movement":
      if (trigger.target === undefined) return;
      dispatch({
        type: "movement",
        payload: { sceneId: trigger.target, chapterId: trigger.chapterId },
      });
      break;
    case "add_flag":
      if (trigger.target === undefined) return;
      dispatch({ type: "add_flag", payload: trigger.target });
      break;
    case "remove_flag":
      if (trigger.target === undefined) return;
      dispatch({ type: "remove_flag", payload: trigger.target });
      break;
    case "remove_all_flags":
      dispatch({ type: "remove_all_flags" });
      break;
    case "remove_all_flags_except":
      if (trigger.target === undefined) return;
      const keptFlags = trigger.target
        .split(",")
        .map((flag) => flag.trim())
        .filter(Boolean);
      if (keptFlags.length === 0) return;
      dispatch({
        type: "remove_all_flags_except",
        payload: keptFlags,
      });
      break;
    default:
      break;
  }
};

export default dispatchTrigger;
