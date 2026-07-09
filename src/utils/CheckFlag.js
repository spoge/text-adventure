const hideAny = (flags, obj) =>
  flags.map((f) => obj.hideAny.includes(f)).filter((f) => f)
    .length > 0;
const hideAll = (flags, obj) =>
  obj.hideAll.map((f) => flags.includes(f)).filter((f) => f)
    .length === obj.hideAll.length;

const showAny = (flags, obj) =>
  flags.map((f) => obj.showAny.includes(f)).filter((f) => f)
    .length > 0;
const showAll = (flags, obj) =>
  obj.showAll.map((f) => flags.includes(f)).filter((f) => f)
    .length === obj.showAll.length;

const isVisible = (flags, obj) => {
  if (
    obj.hideAny !== undefined &&
    hideAny(flags, obj)
  ) {
    return false;
  }
  if (
    obj.hideAll !== undefined &&
    hideAll(flags, obj)
  ) {
    return false;
  }
  if (obj.showAny !== undefined) {
    return showAny(flags, obj);
  }
  if (obj.showAll !== undefined) {
    return showAll(flags, obj);
  }
  return true;
};

const hasShowFlags = (obj) => hasShowAnyFlags(obj) || hasShowAllFlags(obj);
const hasShowAnyFlags = (obj) => obj.showAny !== undefined;
const hasShowAllFlags = (obj) => obj.showAll !== undefined;

const getActiveShowFlagIndex = (flags, obj) =>
  hasShowAnyFlags(obj)
    ? showAnyFlagsIndex(flags, obj)
    : hasShowAllFlags(obj)
    ? showAllFlagsIndex(flags, obj)
    : flags.length;

const showAnyFlagsIndex = (flags, obj) => {
  if (
    obj.showAny === undefined &&
    !showAny(flags, obj)
  ) {
    return flags.length;
  }
  return flags.findIndex((flag) => obj.showAny.includes(flag));
};

const showAllFlagsIndex = (flags, obj) => {
  if (
    obj.showAll === undefined &&
    !showAll(flags, obj)
  )
    return flags.length;

  const lastFlag = [...flags]
    .sort(() => -1)
    .find((flag) => obj.showAll.includes(flag));

  return flags.findIndex((flag) => flag === lastFlag);
};

export { isVisible, hasShowFlags, getActiveShowFlagIndex };
