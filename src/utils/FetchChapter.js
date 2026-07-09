const fetchChapter = (chapterId) => {
  return fetch(`${import.meta.env.BASE_URL}game/${chapterId}.json`, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  }).then(function (response) {
    return response.json();
  });
};

export default fetchChapter;
