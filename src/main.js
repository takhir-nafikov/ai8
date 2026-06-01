const lessonList = document.querySelector("#lesson-list");

if (!lessonList) {
  throw new Error("Lesson list container not found.");
}

lessonList.dataset.enhanced = "true";
