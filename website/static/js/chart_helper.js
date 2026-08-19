if (typeof abbreviateNumber == "undefined") {
  window.abbreviateNumber = function (number, html = undefined,ignore_zero=false) {
    
	if(number <= 0 && ignore_zero){
		return { abbreviated: "" };
	}
	
	const SI_SYMBOL = ["", "K", "M", "B", "T"];
    const tier = (Math.log10(Math.abs(number)) / 3) | 0;
    // If we transcend trillion, let's just leave it as it is.
    if (tier >= SI_SYMBOL.length) {
      tier = SI_SYMBOL.length - 1;
    }
    // Calculate the suffix and decorate the number.
    const suffix = SI_SYMBOL[tier];
    let scale = Math.pow(10, tier * 3);
    let abbreviated = number / scale;
    let formattedNumber = abbreviated.toFixed(1) + suffix;
    // Prepare the HTML title attribute.
    let titleAttribute = "Whole value: " + number;
    if (tier <= 0) {
      formattedNumber = parseInt(number);
    }
    //return an html element
    if (html) {
      let spd = document.createElement("span");
      spd.innerText = formattedNumber;
      if (tier > 0) {
        spd.title = titleAttribute;
      }
      if (formattedNumber.toString.length <= 5) {
        spd.classList.add("big");
      } else {
        spd.classList.add("medium");
      }
      return spd.outerHTML;
    }
    return { abbreviated: formattedNumber, whole: titleAttribute };
  };
}

// ====================
// Pie Chart Generators
// ====================

let chartInstances = {};
let materialColors = [
  "#f44336c5", // Red
  "#2196F3c5", // Blue
  "#4CAF50c5", // Green
  "#FFEB3Bc5", // Yellow
  "#9C27B0c5", // Purple
  "#FF5722c5", // Deep Orange
  "#03A9F4c5", // Light Blue
  "#8BC34Ac5", // Light Green
  "#FFC107c5", // Amber
  "#673AB7c5", // Deep Purple
  "#FF9800c5", // Orange
  "#607D8Bc5", // Blue Grey
  "#E91E63c5", // Pink
  "#00BCD4c5", // Cyan
  "#795548c5", // Brown
  "#9E9E9Ec5", // Grey
  "#CDDC39c5", // Lime
  "#009688c5", // Teal
];

function isDataDifferent(oldData, newData) {
  if (oldData.length !== newData.length) return true; // Different sizes
  for (let i = 0; i < oldData.length; i++) {
    if (
      oldData[i].data !== newData[i].data ||
      oldData[i].label !== newData[i].label
    ) {
      return true; // Found a difference in data or label
    }
  }
  return false; // No differences found
}



function parseProgramName(name) {
    return name;
}


function generatePieChart(
  data,
  elementId = "myGraph",
  labelName = "Pie Graph",
  asPercentage = true,
  colors = materialColors,
) {
  let labels = data.map((item) => item[0]);
  let dataValues = data.map((item) => item[1]);
  let backgroundColors = data.map((_, index) => colors[index % colors.length]);

  let chartData = {
    labels: labels,
    datasets: [
      {
        label: labelName,
        data: dataValues,
        backgroundColor: backgroundColors,
        borderColor: "#ffffffc4",
        borderWidth: 1,
      },
    ],
  };

  if (chartInstances[elementId]) {
    // Check if the data is different to decide on animation
    let currentData = chartInstances[elementId].data.datasets[0].data;
    let newData = chartData.datasets[0].data;
    let shouldAnimate = isDataDifferent(currentData, newData);

    chartInstances[elementId].options.animation = shouldAnimate
      ? undefined
      : false; // Disable animation if data is the same
    chartInstances[elementId].data = chartData;
    chartInstances[elementId].update();
    chartInstances[elementId].options.animation = true;
  } else {
    let ctx = document.getElementById(elementId).getContext("2d");
    chartInstances[elementId] = new Chart(ctx, {
      type: "pie",
      data: chartData,
      options: {
        animation: {}, // Ensure animations are enabled for the first creation
        responsive: true,
        plugins: {
          legend: {
            display: true,
          },
          datalabels: {
            color: "#fff",
            formatter: (value, ctx) => {
              if (asPercentage) {
                let sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
                let percentage = ((value * 100) / sum).toFixed(2) + "%";
                return percentage;
              } else {
                return abbreviateNumber(value).abbreviated;
              }
            },
            anchor: "center",
            align: "center",
          },
        },
      },
    });
  }
}

function generateHorizontalBarChart(
  data,
  elementId = "myGraph",
  labelName = "Bar Graph",
  colors = materialColors,
  raw = false,
  customFormater = undefined,
) {
  let labels = data.map((item) => item[0]);
  let dataValues = data.map((item) => item[1]);
  let backgroundColors = data.map((_, index) => colors[index % colors.length]);

  let chartData = {
    labels: labels,
    datasets: [
      {
        label: labelName,
        data: dataValues,
        backgroundColor: backgroundColors,
        borderColor: "#ffffffc4",
        borderWidth: 1,
      },
    ],
  };

  if (chartInstances[elementId]) {
    // Check if the data is different to decide on animation
    let currentData = chartInstances[elementId].data.datasets[0].data;
    let newData = chartData.datasets[0].data;
    let shouldAnimate = isDataDifferent(currentData, newData);

    chartInstances[elementId].options.animation = shouldAnimate
      ? undefined
      : false; // Disable animation if data is the same
    chartInstances[elementId].data = chartData;
    chartInstances[elementId].update();
    chartInstances[elementId].options.animation = true;
  } else {
    let ctx = document.getElementById(elementId).getContext("2d");
    chartInstances[elementId] = new Chart(ctx, {
      type: "bar", // Change the chart type to "bar"
      data: chartData,
      options: {
        indexAxis: "y", // This makes the bars horizontal
        animation: {}, // Ensure animations are enabled for the first creation
        scales: {
          x: {
            beginAtZero: true, // Ensure x-axis starts from 0
          },
        },
        plugins: {
          legend: {
            display: true,
          },
          datalabels: {
            color: "#fff",
            formatter: (value, ctx) => {
              if (customFormater) {
                return customFormater(value);
              }

              if (raw) {
                return value;
              }

              let sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
              let percentage = ((value * 100) / sum).toFixed(2) + "%";
              return percentage;
            },
            anchor: "center",
            align: "center",
          },
        },
      },
    });
  }
}

function generateVerticalBarChart(
  data,
  elementId = "myGraph",
  labelName = "Bar Graph",
  asPercentage = true,
  colors = materialColors,
) {
  let labels = data.map((item) => item[0]);
  let dataValues = data.map((item) => item[1]);
  let backgroundColors = data.map((_, index) => colors[index % colors.length]);

  let chartData = {
    labels: labels,
    datasets: [
      {
        label: labelName,
        data: dataValues,
        backgroundColor: backgroundColors,
        borderColor: "#ffffffc4",
        borderWidth: 1,
      },
    ],
  };

  if (chartInstances[elementId]) {
    let currentData = chartInstances[elementId].data.datasets[0].data;
    let newData = chartData.datasets[0].data;
    let shouldAnimate = isDataDifferent(currentData, newData);

    chartInstances[elementId].options.animation = shouldAnimate
      ? undefined
      : false;
    chartInstances[elementId].data = chartData;
    chartInstances[elementId].update();
    chartInstances[elementId].options.animation = true;
  } else {
    let ctx = document.getElementById(elementId).getContext("2d");
    chartInstances[elementId] = new Chart(ctx, {
      type: "bar",
      data: chartData,
      options: {
        indexAxis: "x", // Setting it to 'x' for vertical bars
        animation: {},
        responsive: true,
        scales: {
          y: {
            beginAtZero: true, // Ensure y-axis starts from 0 for vertical orientation
          },
        },
        plugins: {
          legend: {
            display: true,
          },
          datalabels: {
            color: "#efefef",
            formatter: (value, ctx) => {
              if (asPercentage) {
                let sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
                let percentage = ((value * 100) / sum).toFixed(2) + "%";
                return percentage;
              } else {
                return abbreviateNumber(value).abbreviated;
              }
            },
            anchor: "center",
            align: "center",
          },
        },
      },
    });
  }
}

function generateLineChart(
  data,
  elementId = "myGraph",
  labelName = "Line Chart",
  asPercentage = true,
  colors = materialColors,
) {
  let labels = data.map((item) => item[0]);
  let dataValues = data.map((item) => item[1]);
  let backgroundColors = data.map((_, index) => colors[index % colors.length]);

  let chartData = {
    labels: labels,
    datasets: [
      {
        label: labelName,
        data: dataValues,
        backgroundColor: backgroundColors,
        borderColor: colors[0], // Set the border color to the first color in the palette
        borderWidth: 2,
        fill: false, // Make sure the line chart doesn't fill under the line
        pointBackgroundColor: colors[0], // Set point color for the data points
        pointRadius: 7, // Size of points on the line
        tension: 0.4, // Controls the curve of the line (0.4 makes it smooth)
      },
    ],
  };

  if (chartInstances[elementId]) {
    let currentData = chartInstances[elementId].data.datasets[0].data;
    let newData = chartData.datasets[0].data;
    let shouldAnimate = isDataDifferent(currentData, newData);

    chartInstances[elementId].options.animation = shouldAnimate
      ? undefined
      : false;
    chartInstances[elementId].data = chartData;
    chartInstances[elementId].update();
    chartInstances[elementId].options.animation = true;
  } else {
    let ctx = document.getElementById(elementId).getContext("2d");
    chartInstances[elementId] = new Chart(ctx, {
      type: "line", // Change chart type to line
      data: chartData,
      options: {
        responsive: true,
        animation: {},
        scales: {
          y: {
            beginAtZero: true, // Ensure y-axis starts from 0
          },
          x: {
            display: true,
          },
        },
        plugins: {
          legend: {
            display: true,
          },
          datalabels: {
            color: getCSSVar("--primary_color_invert"),
            formatter: (value, ctx) => {
              if (asPercentage) {
                let sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
                let percentage = ((value * 100) / sum).toFixed(2) + "%";
                return percentage;
              } else {
                return abbreviateNumber(value).abbreviated;
              }
            },
            anchor: "center",
            align: "center",
          },
        },
      },
    });
  }
}

function generateShadedLineChart(
  data,
  elementId = "myGraph",
  labelName = "Line Chart with Shading",
  asPercentage = true,
  colors = materialColors,
) {
  let labels = data.map((item) => item[0]);
  let dataValues = data.map((item) => item[1]);
  let backgroundColors = data.map((_, index) => colors[index % colors.length]);

  let chartData = {
    labels: labels,
    datasets: [
      {
        label: labelName,
        data: dataValues,
        backgroundColor: colors[0], // Set the fill color to the first color in the palette
        borderColor: colors[0], // Border color is the same as the line
        borderWidth: 2,
        fill: "origin", // Shading below the line
        pointBackgroundColor: colors[0], // Set point color for the data points
        pointRadius: 5, // Size of points on the line
        tension: 0.4, // Controls the curve of the line (0.4 makes it smooth)
      },
    ],
  };

  if (chartInstances[elementId]) {
    let currentData = chartInstances[elementId].data.datasets[0].data;
    let newData = chartData.datasets[0].data;
    let shouldAnimate = isDataDifferent(currentData, newData);

    chartInstances[elementId].options.animation = shouldAnimate
      ? undefined
      : false;
    chartInstances[elementId].data = chartData;
    chartInstances[elementId].update();
    chartInstances[elementId].options.animation = true;
  } else {
    let ctx = document.getElementById(elementId).getContext("2d");
    chartInstances[elementId] = new Chart(ctx, {
      type: "line", // Change chart type to line
      data: chartData,
      options: {
        responsive: true,
        animation: {},
        scales: {
          y: {
            beginAtZero: true, // Ensure y-axis starts from 0
          },
          x: {
            display: true,
          },
        },
        plugins: {
          legend: {
            display: true,
          },
          datalabels: {
            color: "#efefef",
            formatter: (value, ctx) => {
              if (asPercentage) {
                let sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
                let percentage = ((value * 100) / sum).toFixed(2) + "%";
                return percentage;
              } else {
                return abbreviateNumber(value).abbreviated;
              }
            },
            anchor: "center",
            align: "center",
          },
        },
      },
    });
  }
}

function generateMultiLineChart(
  datasets,
  elementId = "myGraph",
  asPercentage = false,
  colors = materialColors,
) {
  // Extract all unique labels from all datasets
  let allLabels = [];
  datasets.forEach((dataset) => {
    dataset.data.forEach((item) => {
      if (!allLabels.includes(item[0])) {
        allLabels.push(item[0]);
      }
    });
  });


  let chartDatasets = datasets.map((dataset, index) => {
    let dataValues = dataset.data.map((item) => item[1]);
    let color = colors[index % colors.length];
	
    return {
      label: parseProgramName(dataset.label),
      data: dataValues,
      backgroundColor: color,
      borderColor: color,
      borderWidth: 2,
      fill: false,
      pointBackgroundColor: color,
      pointBorderColor: "#fff",
      pointBorderWidth: 2,
      pointRadius: 5,
      pointHoverRadius: 7,
      tension: 0.4,
    };
  });

  let chartData = {
    labels: allLabels,
    datasets: chartDatasets,
  };


  if (chartInstances[elementId]) {
    let shouldAnimate = false;

    // Check if any dataset has changed
    if (
      chartInstances[elementId].data.datasets.length !== chartDatasets.length
    ) {
      shouldAnimate = true;
    } else {
      for (let i = 0; i < chartDatasets.length; i++) {
        let currentData = chartInstances[elementId].data.datasets[i].data;
        let newData = chartDatasets[i].data;
        if (isDataDifferent(currentData, newData)) {
          shouldAnimate = true;
          break;
        }
      }
    }

    chartInstances[elementId].options.animation = shouldAnimate
      ? undefined
      : false;
    chartInstances[elementId].data = chartData;
    chartInstances[elementId].update();
    chartInstances[elementId].options.animation = true;
  } else {
    let ctx = document.getElementById(elementId).getContext("2d");
    chartInstances[elementId] = new Chart(ctx, {
      type: "line",
      data: chartData,
      options: {
        responsive: true,
        animation: {},
        scales: {
          y: {
            beginAtZero: true,
          },
          x: {
            display: true,
          },
        },
        plugins: {
          legend: {
            display: true,
			labels: {
				boxWidth: 10,
				boxHeight: 10,
				borderRadius: 5,
			}
          },
          datalabels: {
            color: getCSSVar("--primary_color"),
            formatter: (value, ctx) => {
              if (asPercentage) {
                let sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
                let percentage = ((value * 100) / sum).toFixed(2) + "%";
                return percentage;
              } else {
                return abbreviateNumber(value).abbreviated;
              }
            },
            anchor: "right",
            align: "right",
			padding: {
				top: 4,
				bottom: 4,
				left: 8,
				right: 8,
			  },
			},
        },
      },
    });
  }
}


function generateMultiBarChart(
  datasets,
  elementId = "myGraph",
  asPercentage = false,
  colors = materialColors,
) {
  // Extract all unique labels from all datasets
  let allLabels = [];
  datasets.forEach((dataset) => {
    dataset.data.forEach((item) => {
      if (!allLabels.includes(item[0])) {
        allLabels.push(item[0]);
      }
    });
  });


  let chartDatasets = datasets.map((dataset, index) => {
    let dataValues = dataset.data.map((item) => item[1]);
	
	
    let color = colors[index % colors.length];
	
    return {
      label: parseProgramName(dataset.label),
      data: dataValues,
      backgroundColor: color,
      borderColor: color,
      borderWidth: 2,
      fill: false,
      pointBackgroundColor: color,
      pointBorderColor: "#fff",
      pointBorderWidth: 2,
      pointRadius: 5,
      pointHoverRadius: 7,
      tension: 0.4,
    };
  });

  let chartData = {
    labels: allLabels,
    datasets: chartDatasets,
  };

	
  if (chartInstances[elementId]) {
    let shouldAnimate = false;

    // Check if any dataset has changed
    if (
      chartInstances[elementId].data.datasets.length !== chartDatasets.length
    ) {
      shouldAnimate = true;
    } else {
      for (let i = 0; i < chartDatasets.length; i++) {
        let currentData = chartInstances[elementId].data.datasets[i].data;
        let newData = chartDatasets[i].data;
        if (isDataDifferent(currentData, newData)) {
          shouldAnimate = true;
          break;
        }
      }
    }

    chartInstances[elementId].options.animation = shouldAnimate
      ? undefined
      : false;
    chartInstances[elementId].data = chartData;
    chartInstances[elementId].update();
    chartInstances[elementId].options.animation = true;
  } else {
    let ctx = document.getElementById(elementId).getContext("2d");
    chartInstances[elementId] = new Chart(ctx, {
      type: "bar",
      data: chartData,
      options: {
        responsive: true,
        animation: {},
        scales: {
          y: {
            beginAtZero: true,
			stacked: true,
          },
          x: {
            display: true,
			beginAtZero: true,
			stacked: true,
          },
        },
        plugins: {
          legend: {
            display: true,
			labels: {
				boxWidth: 10,
				boxHeight: 10,
				borderRadius: 5,
			}
          },
          datalabels: {
            color: getCSSVar("--primary_color_invert"),
            formatter: (value, ctx) => {
              if (asPercentage) {
                let sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
                let percentage = ((value * 100) / sum).toFixed(2) + "%";
                return percentage;
              } else {
                return abbreviateNumber(value,false,true).abbreviated;
              }
            },
            anchor: "center",
            align: "center",
          },
        },
      },
    });
  }
}

try {
  Chart.register(ChartDataLabels);
} catch (e) {
  showToast("Loading Data...");
}

function applyChartTheme() {
  return;
  const isDark = current_theme === "dark";

  const textColor = isDark ? "#efefef" : "#383838";
  const gridColor = isDark ? "#333" : "#ccc";
  const borderColor = isDark ? "#555" : "#ddd";
  const labelColor = isDark ? "#ffffff" : "#000000";
  const tooltipBg = isDark ? "#1e1e1e" : "#f9f9f9";
  const fontFamily = "Poppins, sans-serif";

  // 🩵 Ensure safe defaults
  Chart.defaults ??= {};
  Chart.defaults.font ??= {};
  Chart.defaults.scales ??= {};
  Chart.defaults.plugins ??= {};

  // === Base font & color ===
  Chart.defaults.color = textColor;

  // === Axes styling ===
  Chart.defaults.scales.x = {
    ticks: { color: textColor },
    grid: { color: gridColor },
    title: { color: textColor },
  };
  Chart.defaults.scales.y = {
    ticks: { color: textColor },
    grid: { color: gridColor },
    title: { color: textColor },
  };

  // === Legend & Title ===
  Chart.defaults.plugins.legend ??= {};
  Chart.defaults.plugins.legend.labels = { color: textColor };

  Chart.defaults.plugins.title ??= {};
  Chart.defaults.plugins.title.color = textColor;

  // === Tooltip styling ===
  Chart.defaults.plugins.tooltip ??= {};
  Chart.defaults.plugins.tooltip.bodyColor = textColor;
  Chart.defaults.plugins.tooltip.backgroundColor = tooltipBg;

  // ===  Data Labels styling ===
  Chart.defaults.plugins.datalabels ??= {};
  Chart.defaults.plugins.datalabels.color = labelColor;
  Chart.defaults.plugins.datalabels.font = {
    size: 12,
  };
}

// Example usage: note the data format is 2d arrays
// let datas = [['Some Long', 3], ['data2', 1], ['data3', 3]];
// generatePieChart(datas);

// ====================
// Pie Chart Generators End
// ====================



//helpers

function getCSSVar(varName, element = document.documentElement) {
  return getComputedStyle(element)
    .getPropertyValue(varName)
    .trim();
}
