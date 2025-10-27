// Charts module using Chart.js
class Charts {
    constructor() {
        this.charts = {};
    }

    // Initialize all dashboard charts
    async initializeDashboardCharts() {
        const data = await window.api.getDashboardData();
        this.createMonthlySalesChart(data.salesByMonth);
        this.createProjectSalesChart(data.projectBreakdown);
        this.createReservationChart(data.totals);
    }

    // Monthly Sales Trend Chart
    createMonthlySalesChart(salesData) {
        const ctx = document.getElementById('monthlySalesChart');
        if (!ctx) return;

        this.charts.monthlySales = new Chart(ctx, {
            type: 'line',
            data: {
                labels: salesData.map(item => item.month),
                datasets: [{
                    label: 'Monthly Sales (₱)',
                    data: salesData.map(item => item.value),
                    borderColor: '#B31E1E',
                    backgroundColor: 'rgba(179, 30, 30, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    title: {
                        display: true,
                        text: 'Monthly Sales Trend'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: function(value) {
                                return '₱' + (value / 1000000).toFixed(1) + 'M';
                            }
                        }
                    }
                }
            }
        });
    }

    // Sales by Project Chart
    createProjectSalesChart(projectData) {
        const ctx = document.getElementById('projectSalesChart');
        if (!ctx) return;

        this.charts.projectSales = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: projectData.map(item => item.name),
                datasets: [
                    {
                        label: 'Sold',
                        data: projectData.map(item => item.sold),
                        backgroundColor: '#B31E1E',
                    },
                    {
                        label: 'Reserved',
                        data: projectData.map(item => item.reserved),
                        backgroundColor: '#FFC107',
                    },
                    {
                        label: 'Available',
                        data: projectData.map(item => item.available),
                        backgroundColor: '#28A745',
                    }
                ]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    title: {
                        display: true,
                        text: 'Sales by Project'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        stacked: true
                    },
                    x: {
                        stacked: true
                    }
                }
            }
        });
    }

    // Reservation Distribution Chart
    createReservationChart(totalsData) {
        const ctx = document.getElementById('reservationChart');
        if (!ctx) return;

        this.charts.reservation = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: ['Sold', 'Reserved', 'Available'],
                datasets: [{
                    data: [
                        totalsData.sold,
                        totalsData.reserved,
                        totalsData.available
                    ],
                    backgroundColor: [
                        '#B31E1E',
                        '#FFC107',
                        '#28A745'
                    ]
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    title: {
                        display: true,
                        text: 'Reservation Distribution'
                    }
                }
            }
        });
    }

    // Update charts with new data
    updateCharts(newData) {
        Object.values(this.charts).forEach(chart => {
            if (chart) {
                chart.data = newData;
                chart.update();
            }
        });
    }

    // Destroy all charts (useful when switching pages)
    destroyCharts() {
        Object.values(this.charts).forEach(chart => {
            if (chart) {
                chart.destroy();
            }
        });
        this.charts = {};
    }
}

// Export Charts instance
window.charts = new Charts();